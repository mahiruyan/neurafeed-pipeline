// Runs every few minutes: reads Telegram button presses, applies the night rule,
// expires stale news, respects the daily cap and publishes approved posts.
const path = require('path');
const { ROOT, setJobState, allJobStates, getTelegram, setTelegram, loadJob, config } = require('./state');
const rules = require('./rules');
const tg = require('./telegram');
const { publish } = require('./publish');

async function readButtons() {
  const t = getTelegram();
  const updates = await tg.getUpdates(t.offset);
  for (const u of updates) {
    t.offset = u.update_id + 1;
    const cb = u.callback_query;
    if (!cb || String(cb.message?.chat?.id) !== String(tg.CHAT)) continue;
    const [action, id] = String(cb.data || '').split(':');
    const st = allJobStates().find((s) => s.id === id);
    if (!st || st.status !== 'pending') {
      await tg.answerCallback(cb.id, 'Already handled');
      continue;
    }
    if (action === 'ok') {
      setJobState(id, { status: 'approved', by: 'mahir' });
      await tg.answerCallback(cb.id, 'Approved');
    } else if (action === 'no') {
      setJobState(id, { status: 'rejected', by: 'mahir' });
      await tg.answerCallback(cb.id, 'Rejected');
      await tg.editMessage(st.message_id, `❌ Rejected: ${id}`).catch(() => {});
    }
  }
  setTelegram(t);
}

(async () => {
  const cfg = config();
  if (tg.enabled() && cfg.mode !== 'auto') await readButtons();

  const now = new Date();
  for (const st of allJobStates()) {
    const job = loadJob(st.id);
    if (!job) continue;

    if (['pending', 'approved', 'held_cap'].includes(st.status) && rules.isExpired(job, cfg, now)) {
      setJobState(st.id, { status: 'expired' });
      if (tg.enabled() && st.message_id) await tg.editMessage(st.message_id, `⌛ Expired (too old to post): ${st.id}`).catch(() => {});
      continue;
    }

    if (st.status === 'pending') {
      const reason = rules.nightAutoApproveReason(job, st, cfg, now);
      if (reason) setJobState(st.id, { status: 'approved', by: reason });
    }
  }

  // Publish approved posts, oldest first, within the daily cap.
  const approved = allJobStates().filter((s) => s.status === 'approved' || s.status === 'held_cap')
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
  for (const st of approved) {
    // Space posts out so two stories from one run do not land back to back.
    if (rules.minutesSinceLastPost(allJobStates(), now) < (cfg.min_minutes_between_posts || 0)) break;
    if (rules.postsToday(allJobStates(), cfg, now) >= cfg.daily_post_cap) {
      if (st.status !== 'held_cap') {
        setJobState(st.id, { status: 'held_cap' });
        if (tg.enabled()) await tg.sendMessage(`⏸ Daily cap of ${cfg.daily_post_cap} reached. Holding ${st.id} until it is a new day in New York (or it expires).`);
      }
      continue;
    }
    const job = loadJob(st.id);
    if (job?.test) {
      // Test jobs exercise render and upload only. They are never published.
      setJobState(st.id, { status: 'test_done', by: 'test job, not published' });
      continue;
    }
    const files = (st.files || []).map((f) => path.join(ROOT, f));
    try {
      const result = await publish(job, files);
      setJobState(st.id, { status: 'posted', posted_at: new Date().toISOString(), publish: result });
      if (tg.enabled() && st.message_id) {
        const who = st.history?.at(-1)?.by || 'approved';
        await tg.editMessage(st.message_id, `📤 ${result.mode === 'instagram' ? 'Posted to Instagram' : 'Sent for manual posting'}: ${st.id}\n(${who})`).catch(() => {});
      }
    } catch (e) {
      setJobState(st.id, { status: 'publish_failed', error: String(e.message || e) });
      if (tg.enabled()) await tg.sendMessage(`⚠️ Publish failed for ${st.id}: ${String(e.message || e).slice(0, 3500)}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
