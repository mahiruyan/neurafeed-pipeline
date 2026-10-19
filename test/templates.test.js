const test = require('node:test');
const assert = require('node:assert');
const { page } = require('../src/templates');
const { validateJob } = require('../src/validate');

const base = { id: 't', timely: false, sensitive: false, sources: [{ name: 'A', url: 'https://a' }], caption: 'x\n\nSource: A' };
const cover = { kind: 'cover', headline: 'A *thing*', image: { url: 'https://a/1.jpg' } };

test('every slide kind renders', () => {
  const slides = [
    cover,
    { kind: 'card', heading: '1. One', paras: ['p'], note: 'n', _n: 2, _total: 7 },
    { kind: 'product', heading: 'Robot', paras: ['p'] },
    { kind: 'post', author: { name: 'Sam', handle: '@s', verified: true }, platform: 'X', text: 'hello — world' },
    { kind: 'prompt', heading: '2. Two', paras: ['a', 'b'], prompt: 'Do it' },
    { kind: 'summary', points: ['a', 'b'] },
    { kind: 'cta', hook: 'Follow *us*', _account: { followers: 15607, posts: 514 } },
    { kind: 'text', heading: 'Old', paras: ['p'] },
  ];
  for (const s of slides) assert.match(page(s, 'file:///x.jpg', []), /<html>/, s.kind);
  assert.match(page(slides[6], null, []), /15\.6K/);
  assert.doesNotMatch(page(slides[3], null, []), /—/, 'dashes in quoted posts are replaced');
});

test('validation: pictures only where the kind needs one, required fields per kind', () => {
  const ok = { ...base, slides: [cover, { kind: 'card', heading: 'h', paras: ['p'], image: { url: 'https://a/2.jpg' } }, { kind: 'summary', points: ['a', 'b'] }, { kind: 'cta', hook: 'h' }] };
  assert.deepEqual(validateJob(ok, 't'), []);
  const bad = { ...base, slides: [cover, { kind: 'card', heading: 'h' }, { kind: 'post', author: { name: 'x' } }, { kind: 'prompt', heading: 'h' }, { kind: 'cta' }] };
  const p = validateJob(bad, 't').join('\n');
  assert.match(p, /slide 2: image/);
  assert.match(p, /slide 3: a post needs/);
  assert.match(p, /slide 4: prompt is required/);
});
