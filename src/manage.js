// Actions Mahir asks the Telegram bot for: cancel, post now, reschedule, priority, approve, reject.
// Used by src/apply-actions.js (and runnable alone: node src/manage.js <action> <job id> [value]).
const fs = require('fs');
const path = require('path');
const { ROOT, getJobState, setJobState, loadJob, writeSummary, replacedBy } = require('./state');

function manage(action, id, value) {
  const file = path.join(ROOT, 'jobs', `${id}.json`);
  const job = loadJob(id);
  const st = getJobState(id);
  const saveJob = (j) => fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
  if (!job || !st) return `no such job: ${id}`;
  // An old version must never be brought back once a corrected version exists.
  const newer = replacedBy(id);
  if (newer && ['post_now', 'reschedule', 'approve', 'ok'].includes(action)) return `${id} was replaced by ${newer}, use that one`;
  const open = ['approved', 'held_cap', 'pending', 'publish_failed', 'queued', 'rendered'];
  switch (action) {
    case 'cancel':
      if (!open.includes(st.status)) return `${id} is ${st.status}, nothing to cancel`;
      setJobState(id, { status: 'canceled', by: 'mahir (Telegram)' });
      return `canceled ${id}`;
    case 'post_now':
      if (!open.includes(st.status)) return `${id} is ${st.status}, cannot post`;
      saveJob({ ...job, post_at: new Date().toISOString() });
      if (st.status !== 'approved') setJobState(id, { status: 'approved', by: 'mahir (Telegram)', attempts: 0 });
      return `posting ${id} now`;
    case 'reschedule':
      if (!open.includes(st.status)) return `${id} is ${st.status}, cannot reschedule`;
      saveJob({ ...job, post_at: value });
      return `${id} rescheduled to ${value}`;
    case 'priority':
      saveJob({ ...job, priority: Number(value) || 2 });
      return `${id} priority ${value}`;
    case 'approve':
    case 'ok':
      if (st.status !== 'pending') return `${id} is ${st.status}, not waiting for approval`;
      setJobState(id, { status: 'approved', by: 'mahir (Telegram)' });
      return `approved ${id}`;
    case 'reject':
    case 'no':
      if (!open.includes(st.status)) return `${id} is ${st.status}`;
      setJobState(id, { status: 'rejected', by: 'mahir (Telegram)' });
      return `rejected ${id}`;
    default:
      return `unknown action ${action}`;
  }
}

module.exports = { manage };

if (require.main === module) {
  const [action, id, value] = process.argv.slice(2);
  console.log(`::notice::${manage(action, id, value)}`);
  writeSummary();
}
