// The news desk's run log (desk/log.json). Claude adds one entry per run with
//   node src/desklog.js <entry.json>
// It keeps the last 7 days (max 120 runs). The Telegram bot reads it to answer
// "what did you look at, what did you skip and why", and to report on Mahir's requests.
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./state');
const DECISIONS = new Set(['queued', 'skipped', 'covered']);
const REQ_STATUS = new Set(['done', 'cannot', 'waiting']);

const file = () => path.join(ROOT, 'desk', 'log.json');
function readLog() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; }
}

function check(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['entry must be an object'];
  if (!e.summary) p.push('summary is required (one line)');
  if (!Array.isArray(e.considered)) p.push('considered must be an array (can be empty)');
  (e.considered || []).forEach((c, i) => {
    if (!c.story) p.push(`considered[${i}]: story is required`);
    if (!DECISIONS.has(c.decision)) p.push(`considered[${i}]: decision must be queued, skipped or covered`);
    if (c.decision === 'queued' && !c.job_id) p.push(`considered[${i}]: job_id is required when queued`);
    if (c.decision !== 'queued' && !c.reason) p.push(`considered[${i}]: reason is required when not queued`);
  });
  (e.requests || []).forEach((r, i) => {
    if (!r.id) p.push(`requests[${i}]: id is required`);
    if (!REQ_STATUS.has(r.status)) p.push(`requests[${i}]: status must be done, cannot or waiting`);
    if (!r.result) p.push(`requests[${i}]: result is required (one sentence for Mahir)`);
  });
  if (/[–—]/.test(JSON.stringify(e))) p.push('no en dash or em dash');
  return p;
}

function add(entry) {
  const problems = check(entry);
  if (problems.length) return problems;
  const e = { run_at: new Date().toISOString(), ...entry };
  const cutoff = Date.now() - 7 * 864e5;
  const log = [...readLog().filter((x) => new Date(x.run_at).getTime() > cutoff), e].slice(-120);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(log, null, 2) + '\n');
  return [];
}

module.exports = { readLog, add, check };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('usage: node src/desklog.js <entry.json>'); process.exit(1); }
  const problems = add(JSON.parse(fs.readFileSync(f, 'utf8')));
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('desk/log.json updated');
}
