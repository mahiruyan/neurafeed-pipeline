// The website hero image for a news story (out/<id>/hero.jpg + hero.json, published with the media).
//
// The site needs a landscape image at least 1200 px wide that it may reuse. Order:
// 1. A carousel photo from a source that allows reuse (Wikimedia Commons, Pexels, Unsplash, or the
//    company's own newsroom), at least 1200 px wide.
// 2. Otherwise a new landscape illustration (1536x1024) made for NeuraFeed: no copyright question.
// The alt text describes what the image shows (vision model), as Google asks for real alt text.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { download, generate, imgData } = require('./images');
const { imagesOf } = require('./deskfeed');

const MIN_WIDTH = 1200;

// Hosts whose images we may reuse with credit, and the license line the site shows.
const REUSABLE = [
  [/(^|\.)upload\.wikimedia\.org$/, 'Wikimedia Commons (see credit for license)'],
  [/(^|\.)images\.pexels\.com$/, 'Pexels License'],
  [/(^|\.)images\.unsplash\.com$/, 'Unsplash License'],
  [/(^|\.)(openai\.com|anthropic\.com|nvidianews\.nvidia\.com|blogs\.nvidia\.com|blog\.google|storage\.googleapis\.com|about\.fb\.com|news\.microsoft\.com|apple\.com|x\.ai|newsroom\.tiktok\.com)$/, 'Company press image'],
];
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const licenseFor = (url) => REUSABLE.find(([re]) => re.test(hostOf(url)))?.[1] || null;
const plain = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

function dims(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], { timeout: 30000 }).toString().trim();
  const [w, h] = out.split('x').map(Number);
  return { width: w || 0, height: h || 0 };
}

// JPEG, at most 2000 px wide (the site's limit is 10 MB).
function toJpeg(src, dest) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(2000,iw)':-2", '-q:v', '3', '-frames:v', '1', dest], { timeout: 60000 });
  return dims(dest);
}

async function altText(file, headline) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return `Image for: ${headline}`.slice(0, 300);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', max_tokens: 80, messages: [{ role: 'user', content: [
        { type: 'text', text: 'Write alt text for this news image: one plain sentence under 20 words describing only what is visible. No "image of", no guesses about names you cannot read.' },
        { type: 'image_url', image_url: { url: imgData(file) } },
      ] }] }),
    });
    const d = await res.json();
    const t = plain(d.choices?.[0]?.message?.content).replace(/[–—]/g, ',');
    return t ? t.slice(0, 300) : `Image for: ${headline}`.slice(0, 300);
  } catch { return `Image for: ${headline}`.slice(0, 300); }
}

function isNews(job) {
  return job.type !== 'reel' && !['utility', 'single', 'roundup', 'prompt'].includes(job.format) && (job.sources || []).length >= 2;
}

async function prepareHero(job, outDir) {
  if (!isNews(job)) return null;
  const headline = plain(job.slides?.[0]?.headline || job.id);
  const work = path.join(outDir, 'src');
  fs.mkdirSync(work, { recursive: true });
  const dest = path.join(outDir, 'hero.jpg');
  let meta = null;

  for (const [k, m] of imagesOf(job).entries()) {
    const license = licenseFor(m.url);
    if (!license) continue;
    try {
      const raw = await download(m.url, path.join(work, `hero-${k}.img`), 15000);
      if (dims(raw).width < MIN_WIDTH) continue;
      const d = toJpeg(raw, dest);
      meta = { credit: m.credit || hostOf(m.url), license, source_url: m.url, ai: false, ...d };
      break;
    } catch { /* try the next photo */ }
  }

  if (!meta) {
    const prompt = `Wide editorial illustration for a technology news article titled "${headline}". `
      + 'A symbolic, cinematic scene that captures the idea, one clear subject, strong light and high contrast. '
      + 'No real people, no faces of public figures, no logos, blank surfaces, no readable text, letters or labels on any object, no watermarks. '
      + 'Photorealistic, like a magazine feature photo, not a painting, not digital art, no glow effects.';
    const raw = await generate(prompt, path.join(work, 'hero-gen.img'), [], '1536x1024');
    const d = toJpeg(raw, dest);
    meta = { credit: 'Illustration: NeuraFeed (AI-generated)', license: 'Original image created for NeuraFeed', source_url: null, ai: true, ...d };
  }
  meta.alt = await altText(dest, headline);
  fs.writeFileSync(path.join(outDir, 'hero.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

module.exports = { prepareHero, licenseFor, isNews };
