// Decision rules: night window, auto-approval, expiry and the daily cap.

function hourIn(tz, date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(date));
}
function dayIn(tz, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function isNight(cfg, date = new Date()) {
  const { timezone, start_hour, end_hour } = cfg.night_window;
  const h = hourIn(timezone, date);
  return start_hour < end_hour ? h >= start_hour && h < end_hour : h >= start_hour || h < end_hour;
}

const hoursSince = (iso, now = new Date()) => (now - new Date(iso)) / 36e5;

// Story is too old to post? Timely news expires fast, evergreen content slowly.
function isExpired(job, cfg, now = new Date()) {
  const ref = job.story_time || job.created_at;
  const limit = job.timely ? cfg.timely_max_age_hours : cfg.evergreen_max_age_hours;
  return hoursSince(ref, now) > limit;
}

// Rule A (chosen by Mahir): at night, a pending post is published without approval
// if it has waited long enough, is backed by enough sources and is not sensitive.
function nightAutoApproveReason(job, st, cfg, now = new Date()) {
  if (!isNight(cfg, now)) return null;
  if (!st.sent_at || hoursSince(st.sent_at, now) * 60 < cfg.night_autoapprove_after_minutes) return null;
  if (job.sensitive) return null;
  const sources = (job.sources || []).length;
  if (job.timely && sources < cfg.night_autoapprove_min_sources) return null;
  return job.timely ? `night rule: ${sources} sources, not sensitive` : 'night rule: evergreen';
}

// Full-auto mode: decide at render time whether a job may go out without a human.
function autoDecision(job, cfg) {
  if (job.sensitive) return { ok: false, reason: 'sensitive topic, never auto-posted' };
  const sources = (job.sources || []).length;
  if (job.timely && sources < cfg.auto_min_sources_timely) {
    return { ok: false, reason: `only ${sources} source(s), ${cfg.auto_min_sources_timely} required for news` };
  }
  return { ok: true, reason: `auto: ${sources} source(s), not sensitive` };
}

function minutesSinceLastPost(states, now = new Date()) {
  const last = states.map((s) => s.posted_at).filter(Boolean).sort().at(-1);
  return last ? (now - new Date(last)) / 6e4 : Infinity;
}

// Posts only go out inside US prime-time windows (New York time).
function inPostingWindow(cfg, now = new Date()) {
  if (!cfg.posting_windows || !cfg.posting_windows.length) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: cfg.posting_timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  const mins = h * 60 + m;
  const toMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  return cfg.posting_windows.some((w) => mins >= toMin(w.start) && mins < toMin(w.end));
}

function postsToday(states, cfg, now = new Date()) {
  const today = dayIn(cfg.posting_timezone, now);
  return states.filter((s) => s.posted_at && dayIn(cfg.posting_timezone, new Date(s.posted_at)) === today).length;
}

module.exports = { isNight, isExpired, nightAutoApproveReason, autoDecision, minutesSinceLastPost, postsToday, hoursSince, inPostingWindow };
