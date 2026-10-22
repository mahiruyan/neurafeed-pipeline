// Versions of one post (a fix is a new job with "replaces") and one-post-per-request.
const fs = require('fs');
const path = require('path');
const { ROOT, getJobState, setJobState, loadJob } = require('./state');

// A job with "replaces" is a corrected version. Every other open version of the same post (the
// original and any earlier fix) is withdrawn first, so an old headline can never go out. If one of
// them was already posted, the fix is not queued (it would be a second post of the same story).
const OPEN = ['queued', 'rendered', 'pending', 'approved', 'held_cap', 'publish_failed'];
function rootOf(id, seen = new Set()) {
  const j = loadJob(id);
  if (!j?.replaces || seen.has(id)) return id;
  seen.add(id);
  return rootOf(j.replaces, seen);
}
function versionsOf(root) {
  const dir = path.join(ROOT, 'jobs');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    .filter((id) => id === root || rootOf(id) === root);
}
async function replaceOld(job, editMessage) {
  if (!job.replaces) return null;
  const others = versionsOf(rootOf(job.id)).filter((id) => id !== job.id);
  const posted = others.find((id) => getJobState(id)?.status === 'posted');
  if (posted) return `${posted} was already posted, so the corrected version was not queued`;
  for (const id of others) {
    const st = getJobState(id);
    if (st && !OPEN.includes(st.status)) continue;
    setJobState(id, { status: 'canceled', by: `replaced by ${job.id}` });
    if (st?.message_id && editMessage) await editMessage(st.message_id, `🔁 Replaced by a corrected version: ${job.id}`).catch(() => {});
  }
  return null;
}

// One task from Mahir makes one post. A second job for the same task is dropped, unless the
// earlier one failed (then the new one is a retry).
function duplicateOf(job) {
  if (!job.request_id) return null;
  const dir = path.join(ROOT, 'jobs');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const other = loadJob(f.replace(/\.json$/, ''));
    if (!other || other.id === job.id || other.request_id !== job.request_id || other.replaces === job.id || job.replaces === other.id) continue;
    const st = getJobState(other.id);
    if (st && !['invalid', 'render_failed', 'skipped', 'expired'].includes(st.status)) return other.id;
  }
  return null;
}

// Same story, told by its source links. A post Mahir made from his own link and a post the desk
// wrote about the same news share a source URL (the article, the X post, the video). Tracking and
// utm parameters are ignored; bare home pages never count.
function normUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igsh|si$|s$|ref)/i.test(k)) x.searchParams.delete(k);
    const pathPart = x.pathname.replace(/\/+$/, '');
    if (pathPart.length < 2) return null;
    return `${x.hostname.replace(/^(www|m|mobile)\./, '').replace(/^twitter\.com$/, 'x.com')}${pathPart}${x.search}`.toLowerCase();
  } catch { return null; }
}
function urlsOf(job) {
  return new Set([...(job.sources || []).map((s) => s.url), job.link_url, job.video?.url, job.video?.original?.url].map(normUrl).filter(Boolean));
}
const DEAD = ['invalid', 'render_failed', 'skipped', 'expired', 'canceled', 'rejected'];
function sameStory(job, hours = 72, now = Date.now()) {
  const mine = urlsOf(job);
  if (!mine.size) return [];
  const myRoot = rootOf(job.id);
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'jobs')).filter((x) => x.endsWith('.json'))) {
    const other = loadJob(f.replace(/\.json$/, ''));
    if (!other || other.id === job.id || rootOf(other.id) === myRoot) continue;
    const when = new Date(other.created_at || other.story_time || 0).getTime();
    if (!Number.isFinite(when) || now - when > hours * 3600e3) continue;
    const st = getJobState(other.id);
    if (!st || DEAD.includes(st.status)) continue;
    const theirs = urlsOf(other);
    if ([...mine].some((u) => theirs.has(u))) out.push({ id: other.id, status: st.status, posted_at: st.posted_at || null, fromLink: Boolean(other.link_id), message_id: st.message_id || null });
  }
  return out;
}

// What to do when a new job is the same story as another one:
// - a desk post (not from Mahir) is dropped when any live post already covers the story;
// - Mahir's own post always goes ahead: a desk post still waiting is withdrawn in its favor, and
//   if the story is already out, his preview says so before he approves.
async function resolveSameStory(job, editMessage) {
  const same = sameStory(job);
  if (!same.length) return { blocked: null, warning: null };
  if (!job.link_id && !job.request_id) return { blocked: `same story as ${same[0].id} (shares a source link)`, warning: null };
  let warning = null;
  for (const o of same) {
    if (o.status === 'posted') { warning = `⚠️ This story was already posted as ${o.id}${o.posted_at ? ` (${o.posted_at.slice(0, 16).replace('T', ' ')} UTC)` : ''}. Approve only if you want it twice.`; continue; }
    if (o.fromLink) continue;
    setJobState(o.id, { status: 'canceled', by: `Mahir sent this story himself as ${job.id}` });
    if (o.message_id && editMessage) await editMessage(o.message_id, `🔁 Withdrawn: Mahir sent this story himself (${job.id})`).catch(() => {});
  }
  return { blocked: null, warning };
}

module.exports = { replaceOld, duplicateOf, rootOf, versionsOf, normUrl, sameStory, resolveSameStory };
