// Tiny file-backed state kept in the repo so GitHub Actions runs share it.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'state');
const JOBS_STATE = path.join(STATE, 'jobs');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

const jobStatePath = (id) => path.join(JOBS_STATE, `${id}.json`);
const getJobState = (id) => readJson(jobStatePath(id), null);
function setJobState(id, patch) {
  const cur = getJobState(id) || { id, history: [] };
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  if (patch.status && patch.status !== cur.status) {
    next.history = [...(cur.history || []), { status: patch.status, at: next.updated_at, by: patch.by || 'system' }];
  }
  writeJson(jobStatePath(id), next);
  return next;
}
function allJobStates() {
  if (!fs.existsSync(JOBS_STATE)) return [];
  return fs.readdirSync(JOBS_STATE).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(JOBS_STATE, f), null)).filter(Boolean);
}

const telegramPath = path.join(STATE, 'telegram.json');
const getTelegram = () => readJson(telegramPath, { offset: 0 });
const setTelegram = (d) => writeJson(telegramPath, d);

const loadJob = (id) => readJson(path.join(ROOT, 'jobs', `${id}.json`), null);
const config = () => readJson(path.join(ROOT, 'config.json'), {});

module.exports = { ROOT, getJobState, setJobState, allJobStates, getTelegram, setTelegram, loadJob, config, readJson };
