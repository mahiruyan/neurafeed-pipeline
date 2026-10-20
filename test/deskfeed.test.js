const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
const { deskItems, rss, summaryOf } = require('../src/deskfeed');

const now = Date.parse('2026-10-19T12:00:00Z');
const story = (id, extra = {}) => h.job(id, {
  story_time: '2026-10-19T08:00:00Z',
  sources: [{ name: 'Musk on X', url: 'https://x.com/elonmusk/status/1' }, { name: 'Axios', url: 'https://www.axios.com/a' }],
  slides: [{ kind: 'cover', headline: 'A *big* thing' }, { kind: 'card', heading: 'h', paras: ['First fact & detail.', { t: 'Second fact.', strong: true }] }, { kind: 'cta', hook: 'follow' }],
  ...extra,
});

test('only checked, approved or posted news with 2+ sources from the last 72 hours', () => {
  h.reset();
  story('ok'); h.state('ok', 'posted');
  story('waiting'); h.state('waiting', 'pending');
  story('one-source', { sources: [{ name: 'A', url: 'https://a.com/x' }] }); h.state('one-source', 'approved');
  story('reel', { type: 'reel' }); h.state('reel', 'approved');
  story('tips', { format: 'utility' }); h.state('tips', 'approved');
  story('old', { story_time: '2026-10-15T08:00:00Z' }); h.state('old', 'posted');
  assert.deepEqual(deskItems(now).map((i) => i.id), ['ok']);
});

test('item: primary non-social link, plain summary under 600 chars with the sources, valid XML', () => {
  h.reset();
  story('ok'); h.state('ok', 'approved');
  const [i] = deskItems(now);
  assert.equal(i.link, 'https://www.axios.com/a');
  assert.equal(i.title, 'A big thing');
  assert.equal(i.summary, 'First fact & detail. Second fact. Sources: Musk on X, Axios.');
  const xml = rss([i]);
  assert.match(xml, /<description>First fact &amp; detail\./);
  assert.match(xml, /<guid isPermaLink="false">neurafeed-desk:ok<\/guid>/);
  const long = summaryOf({ sources: [{ name: 'A' }], slides: [{ kind: 'card', paras: Array(40).fill('A sentence of about forty characters ok.') }] });
  assert.ok(long.length <= 590, String(long.length));
});

test('desk feed carries the site category, sensitivity and the photos with credits', () => {
  const { categoryOf, imagesOf, rss } = require('../src/deskfeed');
  const job = { priority: 2, site_category: 'robotics', sensitive: true, slides: [
    { kind: 'cover', headline: 'x', image: { url: 'https://a/1.jpg', credit: 'AP', fallback_urls: ['https://a/2.jpg'] } },
    { kind: 'card', paras: ['y'], image: { url: 'https://a/1.jpg', credit: 'AP' } },
    { kind: 'card', paras: ['z'], image: { url: 'https://b/3.jpg', credit: 'Reuters' } },
  ] };
  assert.equal(categoryOf(job), 'robotics');
  assert.equal(categoryOf({ ...job, site_category: undefined, timely: true, priority: 1 }), 'breaking');
  assert.deepEqual(imagesOf(job).map((m) => m.url), ['https://a/1.jpg', 'https://a/2.jpg', 'https://b/3.jpg']);
  const xml = rss([{ id: 'j', title: 't', link: 'https://l', summary: 's', date: new Date(0), sources: [], category: 'robotics', sensitive: true, images: imagesOf(job) }]);
  assert.match(xml, /<nf:category>robotics<\/nf:category>/);
  assert.match(xml, /<nf:sensitive>true<\/nf:sensitive>/);
  assert.match(xml, /<media:content url="https:\/\/b\/3.jpg" medium="image"><media:credit>Reuters<\/media:credit>/);
});
