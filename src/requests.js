// Lifecycle of the tasks Mahir sends the news desk through the Telegram bot.
//
// The task itself is written once by the bot to inbox/requests.json (task_id = its "id").
// Its status is computed here, only from facts, and kept in state/requests.json (Actions own it):
//   pending    saved, waiting for the next news-desk run (also when Claude answered "waiting")
//   running    Claude wrote a job for it; render or validation not finished yet
//   completed  the job rendered and is queued, waiting for Mahir, or posted
//              (or Claude answered "done" for a task that needs no post)
//   failed     Claude answered "cannot", or its job was invalid, failed to render, or was skipped
// "completed" never goes back. "failed" can turn into "running" again when Claude writes a new job
// for the same task (a retry). Telegram is told once per final status, and once if a task waits
// more than STALE_HOURS. Running this twice in a row changes nothing and sends nothing (idempotent).
const fs = require('fs');
const path = require('path');
const { ROOT, getJobState, readJson, writeJson } = require('./state');
const { readLog } = require('./desklog');

const STALE_HOURS = 5;
const OK = new Set(['approved', 'pending', 'held_cap', 'posted', 'publish_failed', 'test_done']);
const BAD = new Set(['invalid', 'render_failed', 'skipped', 'expired']);
const statePath = () => path.join(ROOT, 'state', 'requests.json');

function jobsByRequest() {
  const dir = path.join(ROOT, 'jobs');
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const j = readJson(path.join(dir, f), null);
    if (j?.request_id) (out[j.request_id] ||= []).push(j.id);
  }
  return out;
}

// Pure: what the status should be now, from the desk log answer and the job states.
function evaluate(req, answer, jobIds, stateOf, now = Date.now()) {
  // The newest job for this task decides (a retry writes a newer one).
  const jobs = jobIds.map((id) => ({ id, st: stateOf(id) }));
  const live = jobs.filter((j) => !j.st || !BAD.has(j.st.status));
  const job = live.at(-1) || jobs.at(-1);
  if (job) {
    const s = job.st?.status;
    if (!s || s === 'queued' || s === 'rendered') return { status: 'running', job_id: job.id };
    if (OK.has(s) || s === 'canceled' || s === 'rejected') return { status: 'completed', job_id: job.id, result: answer?.result };
    if (BAD.has(s)) {
      const why = (job.st.problems || []).join('; ') || job.st.by || job.st.error || s;
      return { status: 'failed', job_id: job.id, result: `${job.id}: ${s} (${String(why).slice(0, 300)})` };
    }
  }
  if (answer?.status === 'cannot') return { status: 'failed', result: answer.result };
  if (answer?.status === 'done') {
    // "done" with a job id that never arrived: the job file is missing.
    if (answer.job_id) return { status: 'failed', job_id: answer.job_id, result: `Claude said done, but job ${answer.job_id} does not exist.` };
    return { status: 'completed', result: answer.result };
  }
  const age = (now - new Date(req.created_at).getTime()) / 3600e3;
  return { status: 'pending', result: answer?.status === 'waiting' ? answer.result : undefined, stale: age > STALE_HOURS };
}

// Latest desk answer per task id.
function answers() {
  const out = {};
  for (const run of readLog()) for (const r of run.requests || []) if (r.id) out[r.id] = { ...r, run_at: run.run_at };
  return out;
}

const fmt = (req) => req.original || req.text;
function message(req, rec) {
  if (rec.status === 'completed') return `✅ İsteğin tamamlandı\nİstek: ${fmt(req)}${rec.result ? `\nClaude: ${rec.result}` : ''}${rec.job_id ? `\nPost: ${rec.job_id}` : ''}`;
  if (rec.status === 'failed') return `⚠️ İsteğin yapılamadı\nİstek: ${fmt(req)}\nNeden: ${rec.result || 'bilinmiyor'}\nTekrar denemek için bota "tekrar dene" yazabilirsin.`;
  return `⏳ İsteğin ${STALE_HOURS} saattir bekliyor\nİstek: ${fmt(req)}\nClaude henüz işlemedi. Haber masası çalışıyor mu diye bakmak gerekebilir.`;
}

// Updates state/requests.json and sends the notifications that are due. Returns what changed.
async function syncRequests({ send } = {}) {
  const requests = readJson(path.join(ROOT, 'inbox', 'requests.json'), []);
  const store = readJson(statePath(), {});
  const byReq = jobsByRequest();
  const ans = answers();
  const changes = [];
  for (const req of requests) {
    if (!req?.id) continue;
    const cur = store[req.id] || { status: 'pending', history: [], notified: [] };
    const ids = [...(byReq[req.id] || [])];
    // Claude named the job in the log but forgot "request_id" in it: still count it.
    const named = ans[req.id]?.job_id;
    if (named && !ids.includes(named) && fs.existsSync(path.join(ROOT, 'jobs', `${named}.json`))) ids.push(named);
    const next = evaluate(req, ans[req.id], ids, getJobState);
    if (cur.status === 'completed') next.status = 'completed';
    const rec = { ...cur, job_id: next.job_id || cur.job_id || null, result: next.result ?? cur.result ?? null };
    if (next.status !== cur.status) {
      rec.status = next.status;
      rec.history = [...(cur.history || []), { status: next.status, at: new Date().toISOString() }];
      changes.push({ id: req.id, from: cur.status, to: next.status });
    }
    rec.updated_at = rec.updated_at && next.status === cur.status ? rec.updated_at : new Date().toISOString();
    // One message per final status; a retry that fails again is told again (new job id).
    const key = rec.status === 'pending' ? (next.stale ? 'stale' : null) : rec.status === 'running' ? null : `${rec.status}:${rec.job_id || ''}`;
    if (key && !(rec.notified || []).includes(key)) {
      // Save first, then send: a crash can lose one message, but never sends it twice.
      rec.notified = [...(rec.notified || []), key];
      store[req.id] = rec;
      writeJson(statePath(), store);
      if (send) await send(message(req, rec)).catch((e) => console.log(`::warning::request notice failed: ${e.message}`));
    }
    store[req.id] = rec;
  }
  // Keep 30 days.
  const keep = new Set(requests.map((r) => r.id));
  for (const id of Object.keys(store)) if (!keep.has(id) && Date.now() - new Date(store[id].updated_at || 0).getTime() > 30 * 864e5) delete store[id];
  writeJson(statePath(), store);
  return changes;
}

module.exports = { evaluate, syncRequests, STALE_HOURS };
