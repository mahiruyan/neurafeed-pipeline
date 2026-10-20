const test = require('node:test');
const assert = require('node:assert');
const { licenseFor, isNews } = require('../src/hero');

test('hero photos are reused only from sources that allow it', () => {
  assert.match(licenseFor('https://upload.wikimedia.org/wikipedia/commons/thumb/a/b.jpg/1920px-b.jpg'), /Wikimedia/);
  assert.equal(licenseFor('https://images.pexels.com/photos/1/a.jpeg'), 'Pexels License');
  assert.equal(licenseFor('https://www.anthropic.com/_next/image?url=x'), 'Company press image');
  assert.equal(licenseFor('https://resource.tradingkey.com/uploads/a.jpg'), null);
  assert.equal(licenseFor('not a url'), null);
});

test('only news carousels get a website hero', () => {
  const two = [{ url: 'https://a' }, { url: 'https://b' }];
  assert.equal(isNews({ sources: two, slides: [] }), true);
  assert.equal(isNews({ type: 'reel', sources: two }), false);
  assert.equal(isNews({ format: 'utility', sources: two }), false);
  assert.equal(isNews({ sources: [two[0]] }), false);
});
