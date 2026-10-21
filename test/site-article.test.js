const test = require('node:test');
const assert = require('node:assert');
const { validateSiteArticle } = require('../src/validate');
const { articleOf, rss } = require('../src/deskfeed');

const filler = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const job = {
  id: 'x', sources: [{ name: 'CNBC', url: 'https://www.cnbc.com/a' }, { name: 'Reuters', url: 'https://www.reuters.com/b' }],
  site_article: {
    headline: 'Anthropic signs a $45 billion compute deal', dek: 'The agreement adds capacity through 2028.', summary: 'Anthropic agreed to buy compute.',
    seo_title: 'Anthropic $45 billion compute deal', seo_description: 'Anthropic agreed to a $45 billion compute deal.', answer_summary: 'Anthropic bought compute.', tags: ['Anthropic'],
    paragraphs: [
      { kind: 'fact', text: `Anthropic signed the deal on Oct. 21, 2026. ${filler(150)}`, sources: [0, 1] },
      { kind: 'heading', text: 'What the deal covers' },
      { kind: 'fact', text: filler(150), sources: [1] },
      { kind: 'analysis', text: filler(150) },
      { kind: 'why_it_matters', text: `The first capacity is due in 2027. ${filler(60)}` },
    ],
  },
};

test('a complete site article passes and goes into the desk feed with resolved sources', () => {
  assert.deepEqual(validateSiteArticle(job), []);
  const a = articleOf(job);
  assert.deepEqual(a.paragraphs[0].sources, job.sources);
  assert.deepEqual(a.paragraphs[1].sources, []);
  const xml = rss([{ id: 'x', title: 't', link: job.sources[0].url, summary: 's', date: new Date(0), sources: job.sources, category: 'companies', images: [], sensitive: false, hero: null, article: a }]);
  assert.match(xml, /<nf:article>\{&quot;headline&quot;/);
});

test('problems are reported and keep the article out of the feed', () => {
  const bad = { ...job, site_article: { ...job.site_article, dek: 'A deal — big?', paragraphs: [{ kind: 'fact', text: 'Short.', sources: [5] }] } };
  const p = validateSiteArticle(bad);
  assert.ok(p.some((x) => /dash/.test(x)) && p.some((x) => /questions/.test(x)) && p.some((x) => /indexes/.test(x)) && p.some((x) => /words/.test(x)));
  assert.equal(articleOf(bad), null);
  assert.deepEqual(validateSiteArticle({ sources: [] }), []);
});
