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
const tg = require('./telegram');
const notes = [];
for (const a of pending) {
  const result = manage(a.action, a.job, a.value || '');
  // The job may not be saved yet (its render run is still committing): try again on the next run.
  if (/^no such job/.test(result) && Date.now() - Date.parse(a.at || 0) < 2 * 3600e3) {
    console.log(`::notice::${a.action} ${a.job}: not found yet, will retry`);
    continue;
  }
  a.result = result;
  a.done = new Date().toISOString();
  console.log(`::notice::${a.action} ${a.job}: ${a.result}`);
  if (!/^(canceled|posting|approved|rejected|.* rescheduled to|.* priority)/.test(result)) notes.push(`⚠️ İşlem uygulanmadı (${a.action}: ${a.job})\n${result}`);
}
if (pending.some((a) => a.done)) {
  // Keep the file small: drop finished actions older than 7 days.
  const cutoff = Date.now() - 7 * 864e5;
  list = list.filter((a) => !a.done || Date.parse(a.done) > cutoff);
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
  writeSummary();
}
(async () => { if (tg.enabled()) for (const n of notes) await tg.sendMessage(n).catch(() => {}); })();
