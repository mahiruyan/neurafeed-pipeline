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

const OK = new Set(['approved', 'held_cap', 'posted', 'publish_failed']);
const NOT_NEWS = new Set(['utility', 'single', 'roundup', 'prompt']);
const MAX_ITEMS = 30;
const MAX_AGE_HOURS = 72;
const MAX_SUMMARY = 590; // the website keeps 600 characters of a feed summary

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
const primaryLink = (job) => ((job.sources || []).find((x) => !/(^|\.)(x|twitter|threads|instagram|facebook|tiktok)\.com\//i.test(x.url || '')) || job.sources?.[0])?.url;

function deskItems(now = Date.now()) {
  const items = [];
  for (const st of allJobStates()) {
    if (!OK.has(st.status)) continue;
    const job = loadJob(st.id);
    if (!job || job.type === 'reel' || NOT_NEWS.has(job.format) || job.test) continue;
    if ((job.sources || []).length < 2) continue;
    const when = new Date(job.story_time || job.created_at || st.updated_at).getTime();
    if (!Number.isFinite(when) || now - when > MAX_AGE_HOURS * 3600e3) continue;
    const link = primaryLink(job);
    if (!link) continue;
    items.push({ id: job.id, title: plain(job.slides?.[0]?.headline || job.id), link, summary: summaryOf(job), date: new Date(when), sources: job.sources });
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
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
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

module.exports = { deskItems, summaryOf, factsOf, primaryLink, rss, writeDeskFeed };

if (require.main === module) console.log(`desk feed: ${writeDeskFeed(process.argv[2])} items`);
