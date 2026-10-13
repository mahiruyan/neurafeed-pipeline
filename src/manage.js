// Actions Mahir asks the Telegram bot for: cancel, post now, reschedule, priority, approve, reject.
// Usage: node src/manage.js <action> <job id> [value]
const fs = require('fs');
const path = require('path');
const { ROOT, getJobState, setJobState, loadJob, writeSummary } = require('./state');

const [action, id, value] = process.argv.slice(2);
const file = path.join(ROOT, 'jobs', `${id}.json`);
const job = loadJob(id);
const st = getJobState(id);
const saveJob = (j) => fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
const done = (msg) => { console.log(`::notice::${msg}`); writeSummary(); };

if (!job || !st) { console.log(`::error::no such job: ${id}`); process.exit(1); }
const open = ['approved', 'held_cap', 'pending', 'publish_failed', 'queued', 'rendered'];

switch (action) {
  case 'cancel':
    if (!open.includes(st.status)) return done(`${id} is ${st.status}, nothing to cancel`);
    setJobState(id, { status: 'canceled', by: 'mahir (Telegram)' });
    return done(`canceled ${id}`);
  case 'post_now':
    if (!open.includes(st.status)) return done(`${id} is ${st.status}, cannot post`);
    saveJob({ ...job, post_at: new Date().toISOString() });
    if (st.status !== 'approved') setJobState(id, { status: 'approved', by: 'mahir (Telegram)', attempts: 0 });
    return done(`posting ${id} now`);
  case 'reschedule':
    if (!open.includes(st.status)) return done(`${id} is ${st.status}, cannot reschedule`);
    saveJob({ ...job, post_at: value });
    return done(`${id} rescheduled to ${value}`);
  case 'priority':
    saveJob({ ...job, priority: Number(value) || 2 });
    return done(`${id} priority ${value}`);
  case 'approve':
    if (st.status !== 'pending') return done(`${id} is ${st.status}, not waiting for approval`);
    setJobState(id, { status: 'approved', by: 'mahir (Telegram)' });
    return done(`approved ${id}`);
  case 'reject':
    if (!open.includes(st.status)) return done(`${id} is ${st.status}`);
    setJobState(id, { status: 'rejected', by: 'mahir (Telegram)' });
    return done(`rejected ${id}`);
  default:
    console.log(`::error::unknown action ${action}`); process.exit(1);
}
