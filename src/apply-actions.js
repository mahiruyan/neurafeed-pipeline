// Applies the actions the Telegram bot queued in inbox/actions.json (cancel, post now, approve...).
// Each action runs once and is marked done, so a skipped or repeated run never loses or doubles one.
const fs = require('fs');
const path = require('path');
const { ROOT, writeSummary } = require('./state');
const { manage } = require('./manage');

const FILE = path.join(ROOT, 'inbox', 'actions.json');
let list = [];
try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* none yet */ }
const pending = list.filter((a) => !a.done);
for (const a of pending) {
  a.result = manage(a.action, a.job, a.value || '');
  a.done = new Date().toISOString();
  console.log(`::notice::${a.action} ${a.job}: ${a.result}`);
}
if (pending.length) {
  // Keep the file small: drop finished actions older than 7 days.
  const cutoff = Date.now() - 7 * 864e5;
  list = list.filter((a) => !a.done || Date.parse(a.done) > cutoff);
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
  writeSummary();
}
