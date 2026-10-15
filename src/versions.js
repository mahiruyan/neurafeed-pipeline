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

module.exports = { replaceOld, duplicateOf, rootOf, versionsOf };
