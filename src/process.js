// Runs when new job files land in jobs/: download images, render, send for approval.
const fs = require('fs');
const path = require('path');
const { ROOT, getJobState, setJobState, loadJob, config, writeSummary } = require('./state');
const { autoDecision } = require('./rules');

const cfg = config();
const { fetchImages } = require('./images');
const { renderJob } = require('./render');
const { renderReel } = require('./reel');
const { validateJob } = require('./validate');
const tg = require('./telegram');
const { syncRequests } = require('./requests');
const { replaceOld, duplicateOf } = require('./versions');

function newJobIds() {
  const dir = path.join(ROOT, 'jobs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => {
      const st = getJobState(id);
      return !st || st.status === 'queued' || st.status === 'render_failed';
    });
}

// Followers and post count for the "follow for more" slide, read once per run. Optional.
let accountCache;
async function accountNumbers() {
  if (accountCache !== undefined) return accountCache;
  accountCache = null;
  const { IG_USER_ID: u, IG_ACCESS_TOKEN: t } = process.env;
  if (!u || !t) return null;
  try {
    const d = await (await fetch(`https://graph.instagram.com/${u}?fields=followers_count,media_count&access_token=${encodeURIComponent(t)}`)).json();
    if (d.followers_count) accountCache = { followers: d.followers_count, posts: d.media_count };
  } catch { /* the slide works without numbers */ }
  return accountCache;
}

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function summary(job) {
  const src = (job.sources || []).map((s) => `• ${s.name}: ${s.url}`).join('\n');
  return [
    `🆕 ${job.timely ? 'NEWS' : 'EVERGREEN'} · ${job.id}`,
    job.sensitive ? '⚠️ Sensitive topic: never auto-posted' : '',
    job._clip || '',
    '',
    job.caption,
    '',
    `Sources (${(job.sources || []).length}):`,
    src,
  ].filter((l) => l !== '').join('\n').slice(0, 4000);
}

(async () => {
  const ids = newJobIds();
  if (!ids.length) {
    await syncRequests({ send: tg.enabled() ? (t) => tg.sendMessage(t) : null });
    writeSummary();
    return console.log('No new jobs.');
  }
  for (const id of ids) {
    const job = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', `${id}.json`), 'utf8'));
    const problems = validateJob(job, id);
    if (problems.length) {
      setJobState(id, { status: 'invalid', problems });
      if (tg.enabled()) await tg.sendMessage(`❌ Job ${id} is invalid:\n${problems.join('\n')}`);
      continue;
    }
    const dup = duplicateOf(job);
    const blocked = dup ? `duplicate of ${dup} for the same request` : await replaceOld(job, tg.enabled() ? (mid, t) => tg.editMessage(mid, t) : null);
    if (blocked) {
      setJobState(id, { status: 'skipped', by: blocked });
      if (tg.enabled()) await tg.sendMessage(`⚠️ ${id}: ${blocked}.`);
      continue;
    }
    const outDir = path.join(ROOT, 'out', id);
    const sent = [];
    try {
      let files;
      let errors = [];
      let preview;
      if (job.type === 'reel') {
        const r = await renderReel(job, outDir);
        files = [r.video];
        preview = [r.preview];
        errors = [`layout ${r.layout}, source ${r.source.w}x${r.source.h}, ${Math.round(r.source.duration)}s${r.crop ? `, cropped to ${r.crop.w}x${r.crop.h} at ${r.crop.x},${r.crop.y} (removed another page's frame)` : ''}`];
        if (r.note) errors.push(r.note);
        if (r.resolved && !job.video.resolved) {
          // Save what was found, and credit the original channel (the repost was not the creator).
          job.video.resolved = r.resolved;
          if (r.resolved.channel && (r.resolved.from_search || !job.credit)) {
            job.credit = `${r.resolved.channel} on YouTube`;
            const lines = String(job.caption || '').trimEnd().split('\n');
            if (/^Video:/i.test(lines.at(-1) || '')) lines[lines.length - 1] = `Video: ${job.credit}`; else lines.push('', `Video: ${job.credit}`);
            job.caption = lines.join('\n');
          }
          fs.writeFileSync(path.join(ROOT, 'jobs', `${id}.json`), JSON.stringify(job, null, 2) + '\n');
        }
        job._clip = r.resolved ? `🎬 Original: ${r.resolved.title || r.resolved.url} (${r.resolved.channel || 'YouTube'}), ${mmss(r.resolved.start)} to ${mmss(r.resolved.end)}, match ${Math.round(r.resolved.score * 100)}%${r.resolved.edited ? ', the repost looks edited (only the main part was used)' : ''}` : (r.note ? `🎬 ${r.note}` : null);
      } else {
        job._account = await accountNumbers();
        const img = await fetchImages(job, outDir);
        errors = img.errors;
        files = await renderJob(job, img.paths, outDir, img.badges);
        preview = files;
      }
      fs.rmSync(path.join(outDir, 'src'), { recursive: true, force: true });
      setJobState(id, { status: 'rendered', files: files.map((f) => path.relative(ROOT, f)), image_errors: errors });
      if (cfg.mode === 'auto' && (job.review || job.sensitive) && !job.owner_approved && tg.enabled()) {
        // Sensitive stories and posts made from Mahir's links wait for his OK on Telegram.
        sent.push(...[].concat((await tg.sendAlbum(preview)) || []).map((x) => x.message_id));
        const msg = await tg.sendMessage(`${job.review ? '👀 Your link is ready. Post it?' : '⚠️ Sensitive story, needs your OK'}\n\n${summary(job)}`, [[
          { text: '✅ Approve', callback_data: `ok:${id}` },
          { text: '❌ Reject', callback_data: `no:${id}` },
        ]]);
        sent.push(msg.message_id);
        setJobState(id, { status: 'pending', sent_at: new Date().toISOString(), message_id: msg.message_id, by: job.review ? 'from your link, waiting for Mahir' : 'sensitive, waiting for Mahir' });
      } else if (cfg.mode === 'auto') {
        const d = autoDecision(job, cfg);
        setJobState(id, { status: d.ok ? 'approved' : 'skipped', by: d.reason });
        if (tg.enabled()) {
          sent.push(...[].concat((await tg.sendAlbum(preview)) || []).map((x) => x.message_id));
          sent.push((await tg.sendMessage(`${d.ok ? '🕒 Queued for auto-post' : '⛔ Not auto-posted'} (${d.reason})\n\n${summary(job)}`))?.message_id);
        }
      } else if (tg.enabled()) {
        sent.push(...[].concat((await tg.sendAlbum(preview)) || []).map((x) => x.message_id));
        const msg = await tg.sendMessage(summary(job), [[
          { text: '✅ Approve', callback_data: `ok:${id}` },
          { text: '❌ Reject', callback_data: `no:${id}` },
        ]]);
        sent.push(msg.message_id);
        setJobState(id, { status: 'pending', sent_at: new Date().toISOString(), message_id: msg.message_id });
      }
      // Which Telegram messages show this post, so a reply to any of them is understood by the bot.
      if (sent.filter(Boolean).length) setJobState(id, { tg_messages: sent.filter(Boolean) });
      console.log(`Rendered ${id}: ${files.length} slides`);
    } catch (e) {
      console.error(e);
      setJobState(id, { status: 'render_failed', error: String(e.message || e) });
      if (tg.enabled()) await tg.sendMessage(`⚠️ Render failed for ${id}:\n${String(e.message || e).slice(0, 3500)}`);
    }
  }
  await syncRequests({ send: tg.enabled() ? (t) => tg.sendMessage(t) : null });
  writeSummary();
})().catch((e) => { console.error(e); process.exit(1); });
