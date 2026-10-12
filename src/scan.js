// Collects story leads from Reddit and news RSS feeds into leads/latest.json.
// Runs on GitHub Actions (which can reach Reddit), so the Claude news desk can read
// what people are talking about without needing network access to those sites itself.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'leads', 'latest.json');
const UA = 'web:neurafeed-pipeline:0.1 (by /u/neurafeed_ai)';
const KEEP_HOURS = 36;

const SUBREDDITS = ['OpenAI', 'ChatGPT', 'ClaudeAI', 'singularity', 'artificial', 'LocalLLaMA', 'Bard', 'GeminiAI', 'aivideo', 'StableDiffusion'];

const FEEDS = [
  ['TechCrunch AI', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['The Verge AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['Ars Technica AI', 'https://arstechnica.com/ai/feed/'],
  ['Wired AI', 'https://www.wired.com/feed/tag/ai/latest/rss'],
  ['OpenAI News', 'https://openai.com/news/rss.xml'],
  ['Google AI Blog', 'https://blog.google/technology/ai/rss/'],
  ['NVIDIA Blog', 'https://blogs.nvidia.com/feed/'],
  ['Google News: OpenAI', 'https://news.google.com/rss/search?q=OpenAI+when:1d&hl=en-US&gl=US&ceid=US:en'],
  ['Google News: Anthropic', 'https://news.google.com/rss/search?q=Anthropic+OR+Claude+AI+when:1d&hl=en-US&gl=US&ceid=US:en'],
  ['Google News: Gemini', 'https://news.google.com/rss/search?q=Google+Gemini+when:1d&hl=en-US&gl=US&ceid=US:en'],
  ['Google News: AI', 'https://news.google.com/rss/search?q=artificial+intelligence+when:1d&hl=en-US&gl=US&ceid=US:en'],
];

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/<[^>]+>/g, '').trim();

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// Reddit: OAuth app-only token if secrets exist (most reliable from cloud IPs), else public JSON.
async function redditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await get('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  return (await res.json()).access_token;
}

function redditImages(p) {
  const imgs = [];
  if (/\.(jpe?g|png|webp)$/i.test(p.url || '')) imgs.push(p.url);
  const src = p.preview?.images?.[0]?.source?.url;
  if (src) imgs.push(src.replace(/&amp;/g, '&'));
  if (p.media_metadata) {
    for (const m of Object.values(p.media_metadata)) {
      if (m?.s?.u) imgs.push(m.s.u.replace(/&amp;/g, '&'));
    }
  }
  return [...new Set(imgs)].slice(0, 6);
}

async function scanReddit(errors) {
  const leads = [];
  let token = null;
  try { token = await redditToken(); } catch (e) { errors.push(`reddit token: ${e.message}`); }
  for (const sub of SUBREDDITS) {
    try {
      const url = token ? `https://oauth.reddit.com/r/${sub}/hot?limit=30` : `https://www.reddit.com/r/${sub}/hot.json?limit=30`;
      const res = await get(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
      const data = await res.json();
      for (const c of data.data.children) {
        const p = c.data;
        if (p.stickied) continue;
        leads.push({
          source: `r/${sub}`,
          title: p.title,
          score: p.score,
          comments: p.num_comments,
          time: new Date(p.created_utc * 1000).toISOString(),
          url: p.url_overridden_by_dest || p.url,
          permalink: `https://www.reddit.com${p.permalink}`,
          images: redditImages(p),
          is_video: Boolean(p.is_video),
        });
      }
    } catch (e) {
      errors.push(`r/${sub}: ${e.message}`);
    }
  }
  return leads;
}

function parseFeed(xml, name) {
  const items = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g) || [];
  return items.map((it) => {
    const tag = (t) => (it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1];
    const link = decode(tag('link')) || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    const img = (it.match(/<media:content[^>]*url="([^"]+)"/) || it.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1];
    const when = decode(tag('pubDate') || tag('updated') || tag('published'));
    return {
      source: name,
      title: decode(tag('title')),
      time: when ? new Date(when).toISOString() : null,
      url: link,
      images: img ? [img.replace(/&amp;/g, '&')] : [],
    };
  }).filter((x) => x.title && x.url);
}

async function scanFeeds(errors) {
  const leads = [];
  for (const [name, url] of FEEDS) {
    try {
      const xml = await (await get(url)).text();
      leads.push(...parseFeed(xml, name));
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return leads;
}

// Hacker News: free, not blocked. Keeps AI-related stories from the front page and recent hits.
const AI_WORDS = /\b(ai|a\.i\.|llm|gpt|openai|anthropic|claude|gemini|deepmind|llama|mistral|nvidia|copilot|chatgpt|agent|model|diffusion|grok|xai)\b/i;
async function scanHackerNews(errors) {
  const leads = [];
  for (const url of [
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60',
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points>80,created_at_i>${Math.floor(Date.now() / 1000) - 86400}&hitsPerPage=100`,
  ]) {
    try {
      const data = await (await get(url)).json();
      for (const h of data.hits) {
        if (!AI_WORDS.test(h.title || '')) continue;
        leads.push({
          source: 'Hacker News',
          title: h.title,
          score: h.points,
          comments: h.num_comments,
          time: h.created_at,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          permalink: `https://news.ycombinator.com/item?id=${h.objectID}`,
        });
      }
    } catch (e) {
      errors.push(`Hacker News: ${e.message}`);
    }
  }
  const seen = new Set();
  return leads.filter((l) => !seen.has(l.permalink) && seen.add(l.permalink));
}

(async () => {
  const errors = [];
  const hn = await scanHackerNews(errors);
  const [reddit, news] = [await scanReddit(errors), await scanFeeds(errors)];
  const cutoff = Date.now() - KEEP_HOURS * 36e5;
  const fresh = (l) => !l.time || new Date(l.time).getTime() >= cutoff;
  const out = {
    scanned_at: new Date().toISOString(),
    errors,
    reddit: reddit.filter(fresh).sort((a, b) => b.score - a.score).slice(0, 120),
    hackernews: hn.filter(fresh).sort((a, b) => b.score - a.score).slice(0, 60),
    news: news.filter(fresh).sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 150),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`reddit ${out.reddit.length}, hn ${out.hackernews.length}, news ${out.news.length}, errors ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
