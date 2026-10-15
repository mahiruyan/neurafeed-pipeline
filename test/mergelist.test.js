const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { merge } = require('../src/mergelist');

test('bot appends while Actions mark done: both kept', () => {
  const base = [{ id: 'a', done: false }];
  const actions = [{ id: 'a', done: '2026-10-15T10:00:00Z', result: 'ok' }];
  const bot = [{ id: 'a', done: false }, { id: 'b', done: false }];
  for (const [x, y] of [[actions, bot], [bot, actions]]) {
    const m = merge(base, x, y);
    assert.deepEqual(m.map((i) => i.id).sort(), ['a', 'b']);
    assert.equal(m.find((i) => i.id === 'a').done, '2026-10-15T10:00:00Z');
  }
});

test('pruned on one side stays pruned; link preview fields are kept', () => {
  const base = [{ id: 'old', done: 'x' }, { id: 'l1', url: 'u' }];
  const actions = [{ id: 'l1', url: 'u', preview: { title: 't' } }];
  const bot = [{ id: 'old', done: 'x' }, { id: 'l1', url: 'u' }, { id: 'l2', url: 'v' }];
  const m = merge(base, actions, bot);
  assert.deepEqual(m.map((i) => i.id), ['l1', 'l2']);
  assert.deepEqual(m[0].preview, { title: 't' });
});

test('real git rebase uses the driver instead of stopping on a conflict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-git-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const driver = `node ${path.join(__dirname, '..', 'src', 'mergelist.js')} %O %A %B`;
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'merge.jsonlist.driver', driver);
  fs.mkdirSync(path.join(dir, 'inbox'));
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'inbox/*.json merge=jsonlist\n');
  const f = path.join(dir, 'inbox', 'actions.json');
  fs.writeFileSync(f, JSON.stringify([{ id: 'a', done: false }], null, 2));
  git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'actions');
  fs.writeFileSync(f, JSON.stringify([{ id: 'a', done: 'yes' }], null, 2));
  git('commit', '-qam', 'mark done');
  git('checkout', '-q', 'main');
  fs.writeFileSync(f, JSON.stringify([{ id: 'a', done: false }, { id: 'b', done: false }], null, 2));
  git('commit', '-qam', 'bot appends');
  git('checkout', '-q', 'actions');
  git('rebase', '-q', 'main');
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(out, [{ id: 'a', done: 'yes' }, { id: 'b', done: false }]);
});
