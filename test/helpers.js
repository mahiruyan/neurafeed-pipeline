// Test helpers: a throw-away repo folder that the pipeline modules use instead of the real one.
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-test-'));
process.env.NF_ROOT = root;
for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'IG_USER_ID', 'IG_ACCESS_TOKEN', 'PUBLIC_IMAGE_BASE', 'FB_PAGE_TOKEN', 'THREADS_TOKEN']) delete process.env[k];

const write = (rel, data) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const reset = () => {
  for (const d of ['jobs', 'state', 'inbox', 'desk']) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'jobs'), { recursive: true });
};
const job = (id, extra = {}) => write(`jobs/${id}.json`, { id, caption: `Caption of ${id}`, slides: [], ...extra });
const state = (id, status, extra = {}) => write(`state/jobs/${id}.json`, { id, status, history: [{ status, at: new Date().toISOString(), by: 'test' }], ...extra });

module.exports = { root, write, read, reset, job, state };
