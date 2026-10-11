// Runs when new job files land in jobs/: download images, render, send for approval.
const fs = require('fs');
const path = require('path');
const { ROOT, getJobState, setJobState, config } = require('./state');
const { autoDecision } = require('./rules');

const cfg = config();
const { fetchImages } = require('./images');
const { renderJob } = require('./render');
const { validateJob } = require('./validate');
const tg = require('./telegram');

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

function summary(job) {
  const src = (job.sources || []).map((s) => `• ${s.name}: ${s.url}`).join('\n');
  return [
    `🆕 ${job.timely ? 'NEWS' : 'EVERGREEN'} · ${job.id}`,
    job.sensitive ? '⚠️ Sensitive topic: never auto-posted' : '',
    '',
    job.caption,
    '',
    `Sources (${(job.sources || []).length}):`,
    src,
  ].filter((l) => l !== '').join('\n').slice(0, 4000);
}

(async () => {
  const ids = newJobIds();
  if (!ids.length) return console.log('No new jobs.');
  for (const id of ids) {
    const job = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', `${id}.json`), 'utf8'));
    const problems = validateJob(job, id);
    if (problems.length) {
      setJobState(id, { status: 'invalid', problems });
      if (tg.enabled()) await tg.sendMessage(`❌ Job ${id} is invalid:\n${problems.join('\n')}`);
      continue;
    }
    const outDir = path.join(ROOT, 'out', id);
    try {
      const { paths, errors } = await fetchImages(job, outDir);
      const files = await renderJob(job, paths, outDir);
      fs.rmSync(path.join(outDir, 'src'), { recursive: true, force: true });
      setJobState(id, { status: 'rendered', files: files.map((f) => path.relative(ROOT, f)), image_errors: errors });
      if (cfg.mode === 'auto') {
        const d = autoDecision(job, cfg);
        setJobState(id, { status: d.ok ? 'approved' : 'skipped', by: d.reason });
        if (tg.enabled()) {
          await tg.sendAlbum(files);
          await tg.sendMessage(`${d.ok ? '🕒 Queued for auto-post' : '⛔ Not auto-posted'} (${d.reason})\n\n${summary(job)}`);
        }
      } else if (tg.enabled()) {
        await tg.sendAlbum(files);
        const msg = await tg.sendMessage(summary(job), [[
          { text: '✅ Approve', callback_data: `ok:${id}` },
          { text: '❌ Reject', callback_data: `no:${id}` },
        ]]);
        setJobState(id, { status: 'pending', sent_at: new Date().toISOString(), message_id: msg.message_id });
      }
      console.log(`Rendered ${id}: ${files.length} slides`);
    } catch (e) {
      console.error(e);
      setJobState(id, { status: 'render_failed', error: String(e.message || e) });
      if (tg.enabled()) await tg.sendMessage(`⚠️ Render failed for ${id}:\n${String(e.message || e).slice(0, 3500)}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
