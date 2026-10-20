// End-to-end tests of the Telegram bot (Cloudflare Worker) against a fake GitHub and a fake
// Telegram: nothing real is called. Checks task ids, idempotent confirmations, locked writes under
// concurrent pushes, and that old preview buttons cannot approve a replaced post.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'worker.js'), 'utf8');
const modFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-worker-')), 'worker.mjs');
fs.writeFileSync(modFile, src);

function fakeWorld() {
  const commits = { c0: { tree: 't0', parent: null } };
  const trees = { t0: {} };
  let head = 'c0';
  let n = 0;
  const sent = [];
  const kv = new Map();
  const world = { sent, kv, blobs: {}, files: () => trees[commits[head].tree], conflictsLeft: 0, dispatched: [],
    put(p, content) { const t = `t${++n}`; trees[t] = { ...trees[commits[head].tree], [p]: content }; const c = `c${n}`; commits[c] = { tree: t, parent: head }; head = c; } };
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  world.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.hostname === 'api.telegram.org' && u.pathname.startsWith('/file/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    if (u.hostname === 'api.telegram.org') {
      const method = u.pathname.split('/').pop();
      if (method === 'getFile') { sent.push({ method, ...body }); return json({ ok: true, result: { file_path: 'photos/x.jpg' } }); }
      sent.push({ method, ...body });
      return json({ ok: true, result: { message_id: 999 } });
    }
    const p = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\//, '');
    if (p.startsWith('contents/')) {
      const file = decodeURIComponent(p.slice(9));
      const ref = u.searchParams.get('ref') || head;
      const content = trees[commits[ref].tree][file];
      return content == null ? new Response('missing', { status: 404 }) : new Response(content);
    }
    if (p === 'git/ref/heads/main') return json({ object: { sha: head } });
    if (p.startsWith('git/commits/')) return json({ tree: { sha: commits[p.slice(12)].tree } });
    if (p === 'git/blobs') { const b = `b${++n}`; world.blobs[b] = body.content; return json({ sha: b }); }
    if (p === 'git/trees') { const t = `t${++n}`; trees[t] = { ...trees[body.base_tree] }; for (const e of body.tree) trees[t][e.path] = e.content ?? `blob:${e.sha}`; return json({ sha: t }); }
    if (p === 'git/commits') { const c = `c${++n}`; commits[c] = { tree: body.tree, parent: body.parents[0] }; return json({ sha: c }); }
    if (p === 'git/refs/heads/main') {
      // Someone else pushed in between: the bot must read again and retry.
      if (world.conflictsLeft > 0) { world.conflictsLeft--; world.put('other.txt', String(Date.now())); }
      if (commits[body.sha].parent !== head) return json({ message: 'not a fast forward' }, 422);
      head = body.sha;
      return json({ object: { sha: head } });
    }
    if (p.includes('/dispatches')) { world.dispatched.push(p); return new Response(null, { status: 204 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  world.env = {
    OWNER_CHAT_ID: '1', REPO: 'o/r', GH_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'tok', WEBHOOK_SECRET: 's',
    KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
  };
  return world;
}

async function load(world) {
  globalThis.fetch = world.fetch;
  globalThis.setTimeout = ((orig) => (fn, ms) => orig(fn, Math.min(ms, 5)))(globalThis.setTimeout);
  return (await import(`${modFile}?v=${Math.random()}`)).default;
}
let upd = 1;
const hook = (worker, world, update) => worker.fetch(new Request('https://bot/webhook', {
  method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's' }, body: JSON.stringify({ update_id: upd++, ...update }),
}), world.env, { waitUntil: () => {} });
const press = (data) => ({ callback_query: { id: 'cb', data, message: { chat: { id: 1 }, message_id: 5 } } });
const say = (text) => ({ message: { chat: { id: 1 }, message_id: 6, date: Math.floor(Date.now() / 1000), text } });
const requests = (world) => JSON.parse(world.files()['inbox/requests.json'] || '[]');

test('a confirmed task is saved once with a unique task id, even if confirmed twice', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.kv.set('req:abc12345', JSON.stringify({ text: 'Make the headline sharper', original: 'başlığı sertleştir', job_id: 'j1' }));
  world.kv.set('last_pending', 'rdo:abc12345');
  await hook(worker, world, press('rdo:abc12345'));
  await hook(worker, world, say('evet')); // typed confirmation right after the button
  await hook(worker, world, press('rdo:abc12345')); // second tap
  const list = requests(world);
  assert.equal(list.length, 1);
  assert.match(list[0].id, /^req-\d{4}-\d{2}-\d{2}-abc12345$/);
  assert.equal(list[0].job_id, 'j1');
});

test('the same Telegram update delivered twice is handled once', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.kv.set('req:k1', JSON.stringify({ text: 't' }));
  const body = JSON.stringify({ update_id: 4242, ...press('rdo:k1') });
  const mk = () => new Request('https://bot/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's' }, body });
  await worker.fetch(mk(), world.env, { waitUntil: () => {} });
  world.kv.set('req:k1', JSON.stringify({ text: 't' })); // even if the task were still pending
  await worker.fetch(mk(), world.env, { waitUntil: () => {} });
  assert.equal(requests(world).length, 1);
});

test('locked write: concurrent pushes cause a retry, never a lost or doubled task', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.put('inbox/requests.json', JSON.stringify([{ id: 'req-old', text: 'x', created_at: new Date().toISOString() }]));
  world.conflictsLeft = 2;
  world.kv.set('req:k2', JSON.stringify({ text: 'new task' }));
  await hook(worker, world, press('rdo:k2'));
  const list = requests(world);
  assert.deepEqual(list.map((r) => r.id.replace(/\d{4}-\d{2}-\d{2}-/, '')), ['req-old', 'req-k2']);
  assert.ok(world.files()['other.txt'], 'the other push was kept');
});

test('an old preview button cannot approve a post that is no longer pending', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.put('state/jobs/a.json', JSON.stringify({ id: 'a', status: 'canceled', history: [{ status: 'canceled', by: 'replaced by a-v2' }] }));
  await hook(worker, world, press('ok:a'));
  assert.equal(world.files()['inbox/actions.json'], undefined, 'no approve action queued');
  assert.ok(world.sent.some((m) => m.method === 'sendMessage' && /artık onay beklemiyor/.test(m.text) && /replaced by a-v2/.test(m.text)));
});

test('a pending post can still be approved with its button', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.put('state/jobs/b.json', JSON.stringify({ id: 'b', status: 'pending' }));
  await hook(worker, world, press('ok:b'));
  const actions = JSON.parse(world.files()['inbox/actions.json']);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'ok');
  assert.ok(world.dispatched.some((d) => d.includes('bot-apply.yml')));
});

const msg = (text, extra = {}) => ({ message: { chat: { id: 1 }, message_id: 100 + upd, date: Math.floor(Date.now() / 1000), text, ...extra } });
const lastText = (world) => world.sent.filter((m) => m.method === 'sendMessage').at(-1)?.text || '';
const links = (world) => JSON.parse(world.files()['inbox/links.json'] || '[]');

test('wizard: reel with link, headline, skipped caption, time -> one inbox item with exactly those choices', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  await hook(worker, world, msg('post'));
  assert.match(lastText(world), /Hangi format/);
  await hook(worker, world, press('wz:f:reel'));
  await hook(worker, world, msg('nope'));
  assert.match(lastText(world), /Link bulamadım/);
  await hook(worker, world, msg('https://x.com/a/status/1 bunu kısa tut'));
  await hook(worker, world, msg('Robot katlanmış çamaşırı dolaba koyuyor'));
  await hook(worker, world, press('wz:s'));
  await hook(worker, world, msg('yarın 21:30'));
  assert.match(lastText(world), /Özet[\s\S]*Reels[\s\S]*x\.com[\s\S]*Robot katlanmış[\s\S]*Claude yazacak/);
  await hook(worker, world, press('wz:ok'));
  const l = links(world);
  assert.equal(l.length, 1);
  assert.equal(l[0].format, 'reel');
  assert.equal(l[0].url, 'https://x.com/a/status/1');
  assert.equal(l[0].title, 'Robot katlanmış çamaşırı dolaba koyuyor');
  assert.equal(l[0].caption, null);
  assert.ok(l[0].post_at && new Date(l[0].post_at) > new Date());
  assert.match(l[0].note, /^reel\nbunu kısa tut\nbaşlık: Robot/);
  assert.equal(await world.kv.get('wiz') ?? null, null, 'wizard closed');
  assert.match(lastText(world), /Sıraya aldım/);
});

test('wizard: a picture sent on its own becomes a single post, stored in the repo', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  await hook(worker, world, msg(undefined, { photo: [{ file_id: 'small' }, { file_id: 'big' }] }));
  assert.match(lastText(world), /Başlığı yazmak/);
  await hook(worker, world, msg('Bu robot yürüyor'));
  await hook(worker, world, msg('Açıklama metni'));
  await hook(worker, world, press('wz:t:auto'));
  await hook(worker, world, press('wz:ok'));
  const l = links(world);
  assert.equal(l.length, 1);
  assert.equal(l[0].format, 'single');
  assert.equal(l[0].url, null);
  assert.match(l[0].image_file, /^inbox\/uploads\/link-.*\.jpg$/);
  assert.equal(l[0].post_at, null);
  assert.match(world.files()[l[0].image_file], /^blob:/);
  assert.ok(world.sent.some((m) => m.method === 'getFile' && m.file_id === 'big'), 'largest photo size used');
});

test('wizard: old buttons and cancel do nothing harmful', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  await hook(worker, world, msg('post'));
  await hook(worker, world, press('wz:f:carousel'));
  await hook(worker, world, press('wz:f:reel')); // an old format button pressed again
  await hook(worker, world, msg('iptal'));
  assert.equal(await world.kv.get('wiz') ?? null, null);
  await hook(worker, world, press('wz:ok'));
  assert.equal(links(world).length, 0);
  assert.match(lastText(world), /süresi doldu/);
});

test('a link already in the queue is reported, not silently accepted', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  await hook(worker, world, msg('https://example.com/news'));
  await hook(worker, world, msg('https://example.com/news reel'));
  assert.equal(links(world).length, 1);
  assert.match(lastText(world), /zaten sırada/);
});

test('"ok, fix this" is not taken as a confirmation of an old proposal', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.kv.set('act:k', JSON.stringify({ action: 'cancel', id: 'a', value: '' }));
  world.kv.set('last_pending', 'do:k');
  let asked = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('deepseek')) { asked = JSON.parse(init.body).messages.at(-1).content; return new Response(JSON.stringify({ choices: [{ message: { content: 'tamam' } }] })); }
    return realFetch(url, init);
  };
  world.env.DEEPSEEK_API_KEY = 'k';
  await hook(worker, world, msg('ok bunu düzelt'));
  assert.equal(world.files()['inbox/actions.json'], undefined, 'old cancel not run');
  assert.equal(asked, 'ok bunu düzelt');
});

test('a reply carries the quoted message and its post to the model', async () => {
  const world = fakeWorld();
  const worker = await load(world);
  world.put('state/summary.json', JSON.stringify({ jobs: [{ id: '2026-10-17-gemini-launch', tg: [555] }] }));
  let asked = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('deepseek')) { asked = JSON.parse(init.body).messages.at(-1).content; return new Response(JSON.stringify({ choices: [{ message: { content: 'tamam' } }] })); }
    return realFetch(url, init);
  };
  world.env.DEEPSEEK_API_KEY = 'k';
  await hook(worker, world, msg('bunun başlığını değiştir', { reply_to_message: { message_id: 555, photo: [{ file_id: 'p' }] } }));
  assert.match(asked, /about the post 2026-10-17-gemini-launch/);
  assert.match(asked, /get_post with id 2026-10-17-gemini-launch/);
  assert.match(asked, /bunun başlığını değiştir$/);
});

test('background queue: messages are taken in order and each runs once', async () => {
  const world = fakeWorld();
  const mod = await import(`${modFile}?v=${Math.random()}`);
  globalThis.fetch = world.fetch;
  const store = new Map();
  let alarm = null;
  const state = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; } } };
  const runner = new mod.Runner(state, world.env);
  world.kv.set('req:a', JSON.stringify({ text: 'one' }));
  world.kv.set('req:b', JSON.stringify({ text: 'two' }));
  for (const d of ['rdo:a', 'rdo:b']) await runner.fetch(new Request('https://runner/enqueue', { method: 'POST', body: JSON.stringify({ update_id: 1, ...press(d) }) }));
  assert.ok(alarm, 'alarm set');
  await runner.alarm();
  assert.deepEqual(requests(world).map((r) => r.text), ['one', 'two']);
  assert.deepEqual(store.get('q'), []);
});

test('next desk run is at :52 past an odd New York hour, within 2 hours', async () => {
  const { _test } = await import(`${modFile}?v=${Math.random()}`);
  const now = new Date('2026-10-20T03:11:00Z'); // 23:11 New York
  const next = _test.nextDeskRun(now);
  assert.equal(next.toISOString(), '2026-10-20T03:52:00.000Z'); // 23:52 New York
  assert.ok(next - now <= 2 * 3600e3);
});

test('link status tells waiting, prepared, skipped and posted links apart', async () => {
  const world = fakeWorld();
  world.put('inbox/links.json', JSON.stringify([
    { id: 'link-a', url: 'https://x/a', received_at: '2026-10-20T03:11:00Z', post_at: '2026-10-20T05:01:00Z' },
    { id: 'link-b', url: 'https://x/b', received_at: '2026-10-20T03:12:00Z' },
    { id: 'link-c', url: 'https://x/c', received_at: '2026-10-20T03:13:00Z' },
  ]));
  world.put('inbox/skipped.json', JSON.stringify([{ link_id: 'link-c', reason: 'Could not tell what the video shows.' }]));
  world.put('state/summary.json', JSON.stringify({ jobs: [{ id: '2026-10-20-a-reel', status: 'pending', link_id: 'link-a', headline: 'A' }] }));
  const { _test } = await import(`${modFile}?v=${Math.random()}`);
  globalThis.fetch = world.fetch;
  const out = JSON.parse(await _test.linkStatus(world.env));
  const by = Object.fromEntries(out.links.map((l) => [l.link_id, l]));
  assert.equal(by['link-a'].state, 'job');
  assert.equal(by['link-a'].status, 'pending');
  assert.equal(by['link-b'].state, 'waiting_for_desk');
  assert.ok(by['link-b'].next_desk_run);
  assert.equal(by['link-c'].state, 'skipped');
});
