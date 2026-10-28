// The news desk's verified stories as an RSS feed for the NeuraFeed website.
//
// The website's editorial worker already scans approved RSS feeds and drafts review-only
// articles from them. Instead of letting it crawl the same news again, it reads this feed:
// only stories the desk already checked (at least 2 sources, passed the pipeline rules, approved
// or posted), with a factual summary built from the carousel text (every claim is from the
// sources) and the primary source as the link.
//
// Published with the media repo on GitHub Pages: https://mahiruyan.github.io/neurafeed-media/feed/desk.xml
const fs = require('fs');
const path = require('path');
const { ROOT, allJobStates, loadJob } = require('./state');
const { validateSiteArticle } = require('./validate');

const OK = new Set(['approved', 'held_cap', 'posted', 'publish_failed']);
const NOT_NEWS = new Set(['utility', 'single', 'roundup', 'prompt']);
// Website categories (must match the admin's category slugs).
const SITE_CATEGORIES = ['breaking', 'companies', 'models', 'robotics', 'free-tools', 'policy', 'guides'];
const MAX_ITEMS = 30;
const MAX_AGE_HOURS = 72;
const MAX_SUMMARY = 590; // the website keeps 600 characters of a feed summary
const MEDIA_BASE = process.env.PUBLIC_IMAGE_BASE || 'https://raw.githubusercontent.com/mahiruyan/neurafeed-media/main';

// The prepared website hero (src/hero.js), when the pipeline made one.
function heroOf(id) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', id, 'hero.json'), 'utf8'));
    return { ...m, url: `${MEDIA_BASE}/${id}/hero.jpg` };
  } catch { return null; }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

// The facts of the story, in slide order, from the slide kinds that carry text.
function factsOf(job) {
  const out = [];
  for (const s of job.slides || []) {
    if (s.kind === 'cover' || s.kind === 'cta' || s.kind === 'prompt') continue;
    for (const p of [...(s.paras || []), ...(s.points || [])]) out.push(plain(typeof p === 'object' ? p.t : p));
    if (s.kind === 'post' && s.text && s.author?.name) out.push(`${plain(s.author.name)} wrote: "${plain(s.text)}"`);
    if (s.note) out.push(plain(s.note));
  }
  return out.filter(Boolean);
}

// The desk sets site_category; otherwise a simple guess from the story.
function categoryOf(job) {
  if (SITE_CATEGORIES.includes(job.site_category)) return job.site_category;
  const text = `${job.slides?.[0]?.headline || ''} ${factsOf(job).join(' ')}`.toLowerCase();
  if (/\b(robot|humanoid|robotaxi|self-driving|waymo|tesla bot|optimus|figure ai)\b/.test(text)) return 'robotics';
  if (/\b(law|bill|lawsuit|sue|court|regulat|congress|senate|ban|policy|government|ftc|eu )\b/.test(text)) return 'policy';
  const head = String(job.slides?.[0]?.headline || '').toLowerCase();
  if (/\b(new model|model|gpt-\d|benchmark|reasoning|open-weight)\b/.test(head)) return 'models';
  if (job.priority === 1 && job.timely) return 'breaking';
  return 'companies';
}

// Every distinct real photo in the carousel, cover first, with its credit: the website picks a
// hero it may use (size, license) from these. Generated covers are not files we can link here.
function imagesOf(job) {
  const out = [];
  const seen = new Set();
  for (const s of job.slides || []) {
    const im = s.image || {};
    for (const [k, url] of [im.url, ...(im.fallback_urls || [])].entries()) {
      if (!url || !/^https:\/\//.test(url) || seen.has(url)) continue;
      seen.add(url);
      // The slide's credit belongs to its main photo only, not to its backup URLs.
      out.push({ url, credit: k === 0 ? plain(im.credit || '') : '', slide: s.kind });
    }
  }
  return out.slice(0, 8);
}

function summaryOf(job) {
  const sourcesLine = ` Sources: ${(job.sources || []).map((x) => plain(x.name)).filter(Boolean).join(', ')}.`;
  const room = MAX_SUMMARY - sourcesLine.length;
  let text = '';
  for (const f of factsOf(job)) {
    const next = text ? `${text} ${f}` : f;
    if (next.length > room) break;
    text = next;
  }
  if (!text) text = factsOf(job)[0]?.slice(0, room - 3).replace(/\s+\S*$/, '') + '...';
  return (text + sourcesLine).trim();
}

// The primary source: the first one that is not a social post, else the first.
const SOCIAL = /(^|\.)(x|twitter|threads|instagram|facebook|tiktok)\.(com|net)$/i;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const primaryLink = (job) => ((job.sources || []).find((x) => !SOCIAL.test(hostOf(x.url))) || job.sources?.[0])?.url;

// The site article the desk wrote (job.site_article), with source indexes resolved to links.
// Left out while it has validation problems: the site then simply has no draft for the story.
function articleOf(job) {
  const a = job.site_article;
  if (!a || validateSiteArticle(job).length) return null;
  const src = (n) => ({ name: plain(job.sources[n].name), url: job.sources[n].url });
  // Prompts keep their line breaks (the reader copies them as written).
  const keep = (t) => String(t || '').replace(/\*/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return {
    ...(a.kind === 'guide' ? { kind: 'guide' } : {}),
    headline: plain(a.headline), dek: plain(a.dek), summary: plain(a.summary), seo_title: plain(a.seo_title),
    seo_description: plain(a.seo_description), answer_summary: plain(a.answer_summary),
    tags: (a.tags || []).map(plain).filter(Boolean).slice(0, 8),
    paragraphs: a.paragraphs.map((x) => ({ kind: x.kind, ...(x.title ? { title: plain(x.title) } : {}), text: x.kind === 'prompt' ? keep(x.text) : plain(x.text), sources: x.kind === 'fact' ? x.sources.map(src) : [] })),
  };
}

function deskItems(now = Date.now()) {
  const items = [];
  for (const st of allJobStates()) {
    if (!OK.has(st.status)) continue;
    const job = loadJob(st.id);
    if (!job || job.type === 'reel' || job.test) continue;
    // Guides: utility posts whose site article is a guide (category "guides").
    const guide = job.format === 'utility' && job.site_article?.kind === 'guide';
    if (NOT_NEWS.has(job.format) && !guide) continue;
    if ((job.sources || []).length < 2) continue;
    const when = new Date(job.story_time || job.created_at || st.updated_at).getTime();
    if (!Number.isFinite(when) || now - when > MAX_AGE_HOURS * 3600e3) continue;
    // Several guides can cite the same help page: give each its own link so the site keeps them apart.
    const link = guide ? (() => { try { const u = new URL(primaryLink(job)); u.searchParams.set('nf_guide', job.id); return u.toString(); } catch { return null; } })() : primaryLink(job);
    if (!link) continue;
    items.push({ id: job.id, title: plain(job.slides?.[0]?.headline || job.id), link, summary: summaryOf(job), date: new Date(when), sources: job.sources, category: guide ? 'guides' : categoryOf(job), images: imagesOf(job), sensitive: Boolean(job.sensitive), hero: heroOf(job.id), article: articleOf(job) });
  }
  return items.sort((a, b) => b.date - a.date).slice(0, MAX_ITEMS);
}

function rss(items, now = new Date()) {
  const body = items.map((i) => `    <item>
      <title>${esc(i.title)}</title>
      <link>${esc(i.link)}</link>
      <guid isPermaLink="false">neurafeed-desk:${esc(i.id)}</guid>
      <pubDate>${i.date.toUTCString()}</pubDate>
      <author>NeuraFeed news desk</author>
      <description>${esc(i.summary)}</description>
${i.sources.map((s) => `      <category domain="${esc(s.url)}">${esc(plain(s.name))}</category>`).join('\n')}
      <nf:category>${esc(i.category)}</nf:category>
      <nf:sensitive>${i.sensitive ? 'true' : 'false'}</nf:sensitive>
${i.hero ? `      <nf:hero url="${esc(i.hero.url)}" width="${i.hero.width}" height="${i.hero.height}" ai="${i.hero.ai ? 'true' : 'false'}"><nf:alt>${esc(i.hero.alt || '')}</nf:alt><nf:credit>${esc(i.hero.credit || '')}</nf:credit><nf:license>${esc(i.hero.license || '')}</nf:license>${i.hero.source_url ? `<nf:source>${esc(i.hero.source_url)}</nf:source>` : ''}</nf:hero>` : ''}
${i.article ? `      <nf:article>${esc(JSON.stringify(i.article))}</nf:article>\n` : ''}${(i.images || []).map((m) => `      <media:content url="${esc(m.url)}" medium="image"><media:credit>${esc(m.credit)}</media:credit></media:content>`).join('\n')}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:nf="https://neurafeedai.com/ns/desk">
  <channel>
    <title>NeuraFeed news desk (verified stories)</title>
    <link>https://www.instagram.com/neurafeed.ai/</link>
    <description>AI news stories the NeuraFeed desk checked against at least two sources. Summaries use only facts from those sources.</description>
    <language>en-us</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;
}

function writeDeskFeed(file = path.join(ROOT, 'feed', 'desk.xml')) {
  const items = deskItems();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rss(items));
  return items.length;
}

module.exports = { articleOf, deskItems, summaryOf, factsOf, primaryLink, rss, writeDeskFeed, categoryOf, imagesOf };

if (require.main === module) console.log(`desk feed: ${writeDeskFeed(process.argv[2])} items`);
