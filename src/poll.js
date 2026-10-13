// Runs every few minutes: reads Telegram button presses, applies the night rule,
// expires stale news, respects the daily cap and publishes approved posts.
const path = require('path');
const { ROOT, setJobState, allJobStates, getTelegram, setTelegram, loadJob, config, writeSummary } = require('./state');
const rules = require('./rules');
const tg = require('./telegram');
const { publish } = require('./publish');
const inbox = require('./inbox');

// Reads everything the bot received: Approve / Reject buttons (manual mode) and links
// Mahir sends from his phone, which go into inbox/links.json for the next Reel run.
async function readTelegram(cfg) {
  const t = getTelegram();
  const updates = await tg.getUpdates(t.offset);
  for (const u of updates) {
    t.offset = u.update_id + 1;
    const cb = u.callback_query;
    if (cb && String(cb.message?.chat?.id) === String(tg.CHAT)) {
      const [action, id] = String(cb.data || '').split(':');
      const st = allJobStates().find((s) => s.id === id);
      if (!st || st.status !== 'pending') {
        await tg.answerCallback(cb.id, 'Already handled');
        continue;
      }
      if (action === 'ok') {
        setJobState(id, { status: 'approved', by: 'mahir' });
        await tg.answerCallback(cb.id, 'Approved');
        await tg.editMessage(st.message_id, `✅ Approved, will post in the next US prime-time slot: ${id}`).catch(() => {});
      } else if (action === 'no') {
        setJobState(id, { status: 'rejected', by: 'mahir' });
        await tg.answerCallback(cb.id, 'Rejected');
        await tg.editMessage(st.message_id, `❌ Rejected: ${id}`).catch(() => {});
      }
      continue;
    }
    const msg = u.message;
    if (!msg || String(msg.chat?.id) !== String(tg.CHAT)) continue;
    const text = [msg.text, msg.caption].filter(Boolean).join('\n');
    const entityUrls = [...(msg.entities || []), ...(msg.caption_entities || [])]
      .filter((e) => e.type === 'text_link').map((e) => e.url);
    const added = inbox.addFromMessage(text, entityUrls, msg.message_id, msg.date);
    if (added.length) {
      const NAMES = { reel: 'a Reel', single: 'a single-image post', prompt: 'a prompt carousel', carousel: 'a news carousel', auto: 'a Reel if it is a video, otherwise a news carousel' };
      await tg.sendMessage(`✅ Got it. It will become ${NAMES[added[0].format] || NAMES.auto} within about 2 hours and post in the next US prime-time window.`, null, msg.message_id).catch(() => {});
    } else if (text && !text.startsWith('/')) {
      await tg.sendMessage('Send me a link. Add a word anywhere to pick the format: reel, carousel, tekli, prompt. Add "başlık: ..." to set the headline.', null, msg.message_id).catch(() => {});
    }
  }
  setTelegram(t);
}

process.on('beforeExit', () => { try { writeSummary(); } catch (e) { console.log(`summary failed: ${e.message}`); } });

(async () => {
  const cfg = config();
  // Telegram problems must never block publishing.
  // When the Cloudflare bot is live (a webhook is set) it receives all Telegram updates itself.
  if (tg.enabled()) {
    const hook = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`).then((r) => r.json()).catch(() => null);
    if (!hook?.result?.url) await readTelegram(cfg).catch((e) => console.log(`::warning::Telegram read failed: ${e.message}`));
  }

  // Links the news desk could not turn into a post: tell Mahir why.
  if (tg.enabled()) {
    const fs = require('fs');
    const f = path.join(ROOT, 'inbox', 'skipped.json');
    let skipped = [];
    try { skipped = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none */ }
    let changed = false;
    for (const sk of skipped.filter((x) => !x.notified)) {
      await tg.sendMessage(`🤷 I could not make a post from your link:\n${sk.url || sk.link_id}\nWhy: ${sk.reason}\nTip: send the original news link, or add what it is about in your note.`).catch(() => {});
      sk.notified = true; changed = true;
    }
    if (changed) fs.writeFileSync(f, JSON.stringify(skipped, null, 2) + '\n');
  }

  const now = new Date();
  for (const st of allJobStates()) {
    const job = loadJob(st.id);
    if (!job) continue;

    if (['pending', 'approved', 'held_cap', 'publish_failed'].includes(st.status) && rules.isExpired(job, cfg, now)) {
      setJobState(st.id, { status: 'expired' });
      if (tg.enabled() && st.message_id) await tg.editMessage(st.message_id, `⌛ Expired (too old to post): ${st.id}`).catch(() => {});
      continue;
    }

    if (st.status === 'pending') {
      const reason = rules.nightAutoApproveReason(job, st, cfg, now);
      if (reason) setJobState(st.id, { status: 'approved', by: reason });
    }
  }

  // Test jobs are closed out right away; they are never published.
  for (const st of allJobStates().filter((s) => s.status === 'approved')) {
    if (loadJob(st.id)?.test) setJobState(st.id, { status: 'test_done', by: 'test job, not published' });
  }

  const waiting = allJobStates().filter((s) => s.status === 'approved' || s.status === 'held_cap' || (s.status === 'publish_failed' && (s.attempts || 1) < 3));

  async function publishOne(st) {
    const job = loadJob(st.id);
    if (job?.test) {
      // Test jobs exercise render and upload only. They are never published.
      setJobState(st.id, { status: 'test_done', by: 'test job, not published' });
      return true;
    }
    const files = (st.files || []).map((f) => path.join(ROOT, f));
    try {
      const result = await publish(job, files);
      setJobState(st.id, { status: 'posted', posted_at: new Date().toISOString(), publish: result });
      if (tg.enabled() && st.message_id) {
        const who = st.history?.at(-1)?.by || 'approved';
        await tg.editMessage(st.message_id, `📤 ${result.mode === 'instagram' ? 'Posted to Instagram' : 'Sent for manual posting'}: ${st.id}\n(${who})`).catch(() => {});
      }
      return true;
    } catch (e) {
      const attempts = (st.status === 'publish_failed' ? (st.attempts || 1) : 0) + 1;
      setJobState(st.id, { status: 'publish_failed', error: String(e.message || e), attempts });
      if (tg.enabled()) await tg.sendMessage(`⚠️ Publish failed for ${st.id} (attempt ${attempts} of 3): ${String(e.message || e).slice(0, 3500)}`);
      return false;
    }
  }

  // 1) Posts Mahir scheduled himself ("post_at"): out at that time, any hour, outside the cap.
  for (const st of waiting.filter((s) => loadJob(s.id)?.post_at)) {
    if (new Date(loadJob(st.id).post_at) <= now && !(await publishOne(st))) return;
  }

  // 2) Everything else: only inside US prime-time windows (New York time).
  if (!rules.inPostingWindow(cfg, now)) {
    console.log('Outside posting window, nothing else published.');
    return;
  }

  // Most important first (priority 1 = must post), then the story that expires soonest.
  const prio = (st) => loadJob(st.id)?.priority || 2;
  const storyTime = (st) => new Date(loadJob(st.id)?.story_time || st.updated_at).getTime();
  // Posts from Mahir's own links do not count toward the daily news cap.
  const capCount = () => rules.postsToday(allJobStates().filter((s) => !loadJob(s.id)?.link_id), cfg, now);
  const regular = waiting.filter((s) => !loadJob(s.id)?.post_at)
    .sort((a, b) => prio(a) - prio(b) || storyTime(a) - storyTime(b));
  for (const st of regular) {
    // Space posts out so two stories from one run do not land back to back.
    if (rules.minutesSinceLastPost(allJobStates(), now) < (cfg.min_minutes_between_posts || 0)) break;
    const fromLink = Boolean(loadJob(st.id)?.link_id);
    if (!fromLink && capCount() >= cfg.daily_post_cap) {
      if (st.status !== 'held_cap') {
        setJobState(st.id, { status: 'held_cap' });
        if (tg.enabled()) await tg.sendMessage(`⏸ Daily cap of ${cfg.daily_post_cap} reached. Holding ${st.id} until it is a new day in New York (or it expires).`);
      }
      continue;
    }
    // Stop after a failure: if Instagram is down or blocked, do not burn through the whole queue.
    if (!(await publishOne(st))) break;
  }
})().catch((e) => { console.error(e); console.log(`::error::poll failed: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); process.exit(1); });
