const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const { evaluate, syncRequests, STALE_HOURS } = require('../src/requests');

const req = (id, hoursAgo = 0) => ({ id, text: 'Change the headline', original: 'başlığı değiştir', created_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString() });
const st = (map) => (id) => (map[id] ? { status: map[id] } : null);

test('pending until the desk answers or writes a job', () => {
  assert.equal(evaluate(req('r1'), undefined, [], st({})).status, 'pending');
  assert.equal(evaluate(req('r1'), { status: 'waiting', result: 'later' }, [], st({})).status, 'pending');
  assert.equal(evaluate(req('r1', STALE_HOURS + 1), undefined, [], st({})).stale, true);
});

test('running while the job renders, completed once it is queued or posted', () => {
  assert.equal(evaluate(req('r'), { status: 'done', job_id: 'j' }, ['j'], st({})).status, 'running');
  assert.equal(evaluate(req('r'), undefined, ['j'], st({ j: 'queued' })).status, 'running');
  for (const s of ['approved', 'pending', 'held_cap', 'posted']) assert.equal(evaluate(req('r'), undefined, ['j'], st({ j: s })).status, 'completed', s);
});

test('failed when the desk cannot, or the job is invalid / not rendered / skipped', () => {
  assert.equal(evaluate(req('r'), { status: 'cannot', result: 'already posted' }, [], st({})).status, 'failed');
  for (const s of ['invalid', 'render_failed', 'skipped']) assert.equal(evaluate(req('r'), { status: 'done', job_id: 'j' }, ['j'], st({ j: s })).status, 'failed', s);
  // "done" naming a job that does not exist is a failure, not a success.
  assert.equal(evaluate(req('r'), { status: 'done', job_id: 'ghost' }, [], st({})).status, 'failed');
  assert.equal(evaluate(req('r'), { status: 'done', result: 'answered' }, [], st({})).status, 'completed');
});

test('a retry job after a failed one counts (newest live job decides)', () => {
  assert.equal(evaluate(req('r'), undefined, ['j', 'j-v3'], st({ j: 'invalid' })).status, 'running');
  assert.equal(evaluate(req('r'), undefined, ['j', 'j-v3'], st({ j: 'invalid', 'j-v3': 'approved' })).status, 'completed');
});

test('sync is idempotent: one message per final status, completed never goes back', async () => {
  h.reset();
  h.write('inbox/requests.json', [req('req-1'), req('req-2')]);
  h.job('a-v2', { request_id: 'req-1', replaces: 'a' });
  h.write('desk/log.json', [{ run_at: new Date().toISOString(), summary: 's', considered: [], requests: [{ id: 'req-1', status: 'done', job_id: 'a-v2', result: 'Headline changed.' }, { id: 'req-2', status: 'cannot', result: 'Already posted.' }] }]);
  const sent = [];
  const send = async (t) => { sent.push(t); };

  await syncRequests({ send });
  let s = h.read('state/requests.json');
  assert.equal(s['req-1'].status, 'running');
  assert.equal(s['req-2'].status, 'failed');
  assert.equal(sent.length, 1);

  h.state('a-v2', 'approved');
  await syncRequests({ send });
  await syncRequests({ send });
  s = h.read('state/requests.json');
  assert.equal(s['req-1'].status, 'completed');
  assert.equal(sent.length, 2, 'completed told exactly once');
  assert.match(sent[1], /tamamlandı/);

  h.state('a-v2', 'expired');
  await syncRequests({ send });
  assert.equal(h.read('state/requests.json')['req-1'].status, 'completed');
  assert.equal(sent.length, 2);
});

test('a job that forgot request_id is still matched through the log', async () => {
  h.reset();
  h.write('inbox/requests.json', [req('req-9')]);
  h.job('story-x');
  h.state('story-x', 'approved');
  h.write('desk/log.json', [{ run_at: new Date().toISOString(), summary: 's', considered: [], requests: [{ id: 'req-9', status: 'done', job_id: 'story-x', result: 'ok' }] }]);
  await syncRequests({});
  assert.equal(h.read('state/requests.json')['req-9'].status, 'completed');
});

test('a stale request warns once', async () => {
  h.reset();
  h.write('inbox/requests.json', [req('req-old', STALE_HOURS + 2)]);
  const sent = [];
  await syncRequests({ send: async (t) => sent.push(t) });
  await syncRequests({ send: async (t) => sent.push(t) });
  assert.equal(sent.length, 1);
  assert.equal(h.read('state/requests.json')['req-old'].status, 'pending');
});

test('state is saved before the message, so a crash never sends twice', async () => {
  h.reset();
  h.write('inbox/requests.json', [req('req-c')]);
  h.write('desk/log.json', [{ run_at: new Date().toISOString(), summary: 's', considered: [], requests: [{ id: 'req-c', status: 'cannot', result: 'no' }] }]);
  await assert.rejects(syncRequests({ send: async () => { throw new Error('ignored'); } }).then(() => { throw new Error('done'); }), /done/);
  const sent = [];
  await syncRequests({ send: async (t) => sent.push(t) });
  assert.equal(sent.length, 0);
});
