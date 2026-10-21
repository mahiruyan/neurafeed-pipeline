const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { needsHero } = require('../src/site-heroes');

test('a site draft needs a hero unless a desk story or an earlier run covers it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  const id = '019bfc68-0000-7000-8000-000000000301';
  const desk = new Set(['https://www.cnbc.com/a']);
  assert.equal(needsHero({ id, sources: [{ url: 'https://other.com/x' }] }, desk, dir), true);
  assert.equal(needsHero({ id, sources: [{ url: 'https://www.cnbc.com/a/' }] }, desk, dir), false);
  assert.equal(needsHero({ id: '../x', sources: [] }, desk, dir), false);
  fs.mkdirSync(path.join(dir, 'site', id), { recursive: true }); fs.writeFileSync(path.join(dir, 'site', id, 'hero.json'), '{}');
  assert.equal(needsHero({ id, sources: [] }, desk, dir), false);
});
