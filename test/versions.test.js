const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const { replaceOld, duplicateOf } = require('../src/versions');
const { replacedBy, getJobState } = require('../src/state');
const { manage } = require('../src/manage');

test('a fix withdraws the old version, even one that was never rendered', async () => {
  h.reset();
  h.job('a');
  h.job('a-v2', { replaces: 'a' });
  assert.equal(await replaceOld(require('../src/state').loadJob('a-v2')), null);
  assert.equal(getJobState('a').status, 'canceled');
});

test('a fix withdraws every open version (original and earlier fix), and edits the old preview', async () => {
  h.reset();
  h.job('a'); h.state('a', 'canceled');
  h.job('a-v2', { replaces: 'a' }); h.state('a-v2', 'pending', { message_id: 77 });
  h.job('a-v3', { replaces: 'a' }); // the desk pointed at the original instead of v2
  const edits = [];
  await replaceOld(require('../src/state').loadJob('a-v3'), async (m, t) => edits.push([m, t]));
  assert.equal(getJobState('a-v2').status, 'canceled');
  assert.deepEqual(edits.map((e) => e[0]), [77]);
});

test('no fix is queued when an earlier version is already posted', async () => {
  h.reset();
  h.job('a'); h.state('a', 'posted');
  h.job('a-v2', { replaces: 'a' });
  assert.match(await replaceOld(require('../src/state').loadJob('a-v2')), /already posted/);
});

test('an old version cannot be approved, posted now or rescheduled once a fix exists', () => {
  h.reset();
  h.job('a'); h.state('a', 'pending');
  h.job('a-v2', { replaces: 'a' });
  assert.equal(replacedBy('a'), 'a-v2');
  for (const action of ['approve', 'ok', 'post_now', 'reschedule']) assert.match(manage(action, 'a', '2026-10-16T10:00:00Z'), /replaced by a-v2/);
  assert.equal(getJobState('a').status, 'pending');
  assert.match(manage('cancel', 'a'), /^canceled/); // withdrawing is always allowed
});

test('one post per request: a second job for the same request is a duplicate unless the first failed', () => {
  h.reset();
  h.job('x', { request_id: 'req-1' }); h.state('x', 'approved');
  h.job('y', { request_id: 'req-1' });
  assert.equal(duplicateOf(require('../src/state').loadJob('y')), 'x');
  h.state('x', 'invalid');
  assert.equal(duplicateOf(require('../src/state').loadJob('y')), null);
});
