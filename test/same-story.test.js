const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const { normUrl, sameStory, resolveSameStory } = require('../src/versions');
const { getJobState } = require('../src/state');

const now = new Date().toISOString();
const src = (url) => [{ name: 'X', url }];

test('source links are compared without tracking parameters, www or twitter.com', () => {
  assert.equal(normUrl('https://www.cnbc.com/2026/10/21/meta.html?utm_source=x#top'), normUrl('https://cnbc.com/2026/10/21/meta.html/'));
  assert.equal(normUrl('https://twitter.com/sama/status/1?s=20'), normUrl('https://x.com/sama/status/1'));
  assert.equal(normUrl('https://openai.com/'), null);
});

test('a desk post is dropped when Mahir already sent the same story', async () => {
  h.reset();
  h.job('mine', { created_at: now, link_id: 'link-1', sources: src('https://x.com/sama/status/1') });
  h.state('mine', 'posted', { posted_at: now });
  h.job('desk', { created_at: now, sources: src('https://twitter.com/sama/status/1?s=46') });
  const r = await resolveSameStory(require('../src/state').loadJob('desk'));
  assert.match(r.blocked, /same story as mine/);
});

test("Mahir's post withdraws a waiting desk post and warns when the story is already out", async () => {
  h.reset();
  h.job('desk-waiting', { created_at: now, sources: src('https://www.reuters.com/a') });
  h.state('desk-waiting', 'approved');
  h.job('desk-posted', { created_at: now, sources: src('https://www.cnbc.com/b') });
  h.state('desk-posted', 'posted', { posted_at: now });
  h.job('mine', { created_at: now, link_id: 'link-2', sources: [...src('https://reuters.com/a?utm_medium=social'), ...src('https://cnbc.com/b')] });
  const r = await resolveSameStory(require('../src/state').loadJob('mine'));
  assert.equal(r.blocked, null);
  assert.match(r.warning, /already posted as desk-posted/);
  assert.equal(getJobState('desk-waiting').status, 'canceled');
  assert.equal(getJobState('desk-posted').status, 'posted');
});

test('different stories and old posts do not match', () => {
  h.reset();
  h.job('old', { created_at: '2026-01-01T00:00:00Z', sources: src('https://a.com/x') });
  h.state('old', 'posted');
  h.job('new', { created_at: now, sources: src('https://a.com/x') });
  h.job('other', { created_at: now, sources: src('https://b.com/y') });
  h.state('other', 'approved');
  assert.deepEqual(sameStory(require('../src/state').loadJob('new')), []);
});
