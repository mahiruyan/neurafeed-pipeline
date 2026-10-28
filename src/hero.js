// The website hero image for a news story (out/<id>/hero.jpg + hero.json, published with the media).
//
// The site needs a landscape image at least 1200 px wide that it may reuse. Order:
// 1. A carousel photo from a source that allows reuse (Wikimedia Commons, Pexels, Unsplash, or the
//    company's own newsroom), at least 1200 px wide.
// 2. Otherwise any story photo with credit, then the source articles' main photo (og:image).
// 3. Only when there is no photo at all: a landscape illustration made for NeuraFeed.
// The alt text describes what the image shows (vision model), as Google asks for real alt text.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { askVision, download, generate } = require('./images');
const { imagesOf } = require('./deskfeed');

const MIN_WIDTH = 1200;

// Hosts whose images we may reuse with credit, and the license line the site shows.
const REUSABLE = [
  [/(^|\.)upload\.wikimedia\.org$/, 'Wikimedia Commons (see credit for license)', 'Wikimedia Commons'],
  [/(^|\.)images\.pexels\.com$/, 'Pexels License', 'Pexels'],
  [/(^|\.)images\.unsplash\.com$/, 'Unsplash License', 'Unsplash'],
  [/(^|\.)openai\.com$/, 'Company press image', 'OpenAI'],
  [/(^|\.)anthropic\.com$/, 'Company press image', 'Anthropic'],
  [/(^|\.)(nvidianews|blogs)\.nvidia\.com$/, 'Company press image', 'NVIDIA'],
  [/(^|\.)(blog\.google|storage\.googleapis\.com)$/, 'Company press image', 'Google'],
  [/(^|\.)about\.fb\.com$/, 'Company press image', 'Meta'],
  [/(^|\.)news\.microsoft\.com$/, 'Company press image', 'Microsoft'],
  [/(^|\.)apple\.com$/, 'Company press image', 'Apple'],
  [/(^|\.)x\.ai$/, 'Company press image', 'xAI'],
];
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const licenseFor = (url) => REUSABLE.find(([re]) => re.test(hostOf(url)))?.[1] || null;
const ownerOf = (url) => REUSABLE.find(([re]) => re.test(hostOf(url)))?.[2] || hostOf(url);
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
  try {
    const t = plain(await askVision(file, 'Write alt text for this news image: one plain sentence under 20 words describing only what is visible. No "image of", no guesses about names you cannot read.', { maxTokens: 80, detail: 'auto' })).replace(/[–—]/g, ',');
    return t ? t.slice(0, 300) : headline.slice(0, 300);
  } catch (e) { console.log(`::warning::alt text: ${e.message}`); return headline.slice(0, 300); }
}

// Photos with big words baked in (title cards, promo graphics, video thumbnails) look broken on the
// site, where the photo is cropped under our own headline. A vision check flags them; on any error
// the photo is accepted. Flagged photos are kept only as a last resort before an illustration.
async function hasBakedText(file) {
  try {
    const answer = await askVision(file, 'Is this a graphic with large words placed on it: a title, a headline, a product or model name, a big logo wordmark, a promo banner or a video thumbnail with text? '
      + 'Small or incidental text does not count (a sign in the background, text on a screen or a device, a small logo, a watermark). Answer only YES or NO.', { maxTokens: 5 });
    return /^\s*yes/i.test(answer || '');
  } catch (e) { console.log(`::warning::text check: ${e.message}`); return false; }
}

// Accepts a prepared hero unless it has big baked-in text; the first such photo is kept aside.
async function clean(dest, meta, spare) {
  if (!(await hasBakedText(dest))) return meta;
  console.log(`hero: skipped a photo with big text on it (${meta.source_url || ''})`);
  if (spare && !spare.meta) { fs.copyFileSync(dest, `${dest}.spare`); spare.meta = meta; }
  return null;
}
function useSpare(dest, spare) {
  if (!spare?.meta) return null;
  fs.copyFileSync(`${dest}.spare`, dest); fs.rmSync(`${dest}.spare`, { force: true });
  return spare.meta;
}

function isNews(job) {
  return job.type !== 'reel' && !['utility', 'single', 'roundup', 'prompt'].includes(job.format) && (job.sources || []).length >= 2;
}

// Any photo at least 1200 px wide, credited to the photographer or the site it came from.
async function anyPhoto(images, work, dest, spare = {}) {
  for (const [k, m] of images.entries()) {
    if (!m?.url || /^(assets|inbox)\//.test(m.url)) continue;
    try {
      const raw = await download(m.url, path.join(work, `any-${k}.img`), 15000);
      if (dims(raw).width < MIN_WIDTH) continue;
      const d = toJpeg(raw, dest);
      const meta = await clean(dest, { credit: m.credit || ownerOf(m.url), license: 'Used with credit', source_url: m.url, ai: false, ...d }, spare);
      if (meta) return meta;
    } catch { /* next */ }
  }
  return null;
}

// A new landscape illustration made for NeuraFeed (no copyright question).
async function illustration(headline, work, dest) {
  const prompt = `Wide editorial illustration for a technology news article titled "${headline}". `
    + 'A symbolic, cinematic scene that captures the idea, one clear subject, strong light and high contrast. '
    + 'No real people, no faces of public figures, no logos, blank surfaces, no readable text, letters or labels on any object, no watermarks. '
    + 'Photorealistic, like a magazine feature photo, not a painting, not digital art, no glow effects.';
  const raw = await generate(prompt, path.join(work, 'hero-gen.img'), [], '1536x1024');
  const d = toJpeg(raw, dest);
  return { credit: 'Illustration: NeuraFeed (AI-generated)', license: 'Original image created for NeuraFeed', source_url: null, ai: true, ...d };
}

// The hero for a website draft that did not come from a desk story: an illustration only.
// The main image of a web page (og:image / twitter:image), absolute URL.
async function pageImage(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NeuraFeedBot/1.0)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400000);
    const m = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i.exec(html)
      || /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
    return m ? new URL(m[1].replace(/&amp;/g, '&'), pageUrl).toString() : null;
  } catch { return null; }
}

async function illustrateDraft(headline, outDir, sourceUrls = []) {
  const work = path.join(outDir, 'src');
  fs.mkdirSync(work, { recursive: true });
  const dest = path.join(outDir, 'hero.jpg');
  // Real photo first (the source articles' main photos), an illustration only when none exists.
  const images = [];
  for (const u of sourceUrls.slice(0, 4)) { const img = await pageImage(u); if (img) images.push({ url: img, credit: ownerOf(u).replace(/^www\./, '') }); }
  const spare = {};
  let meta = await anyPhoto(images, work, dest, spare);
  if (!meta) meta = useSpare(dest, spare);
  if (!meta) { try { meta = await illustration(plain(headline), work, dest); } catch (e) { console.log(`::warning::illustration: ${e.message}`); } }
  if (!meta) throw new Error('no illustration and no source photo at least 1200 px wide');
  meta.alt = await altText(dest, plain(headline));
  fs.writeFileSync(path.join(outDir, 'hero.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.rmSync(work, { recursive: true, force: true });
  return meta;
}

async function prepareHero(job, outDir) {
  if (!isNews(job)) return null;
  const headline = plain(job.slides?.[0]?.headline || job.id);
  const work = path.join(outDir, 'src');
  fs.mkdirSync(work, { recursive: true });
  const dest = path.join(outDir, 'hero.jpg');
  let meta = null;
  const spare = {};

  for (const [k, m] of imagesOf(job).entries()) {
    const license = licenseFor(m.url);
    if (!license) continue;
    try {
      const raw = await download(m.url, path.join(work, `hero-${k}.img`), 15000);
      if (dims(raw).width < MIN_WIDTH) continue;
      const d = toJpeg(raw, dest);
      // Press images are credited to the company; Wikimedia, Pexels and Unsplash to the photographer
      // when the desk named one for this exact photo.
      const credit = license === 'Company press image' ? ownerOf(m.url) : (m.credit || ownerOf(m.url));
      meta = await clean(dest, { credit, license, source_url: m.url, ai: false, ...d }, spare);
      if (meta) break;
    } catch { /* try the next photo */ }
  }

  // Mahir wants real photos on the site, not AI images: the story's own photos with credit, then the
  // source articles' main photos. The source URL is kept so a photo can be swapped on request.
  if (!meta) meta = await anyPhoto(imagesOf(job), work, dest, spare);
  if (!meta) {
    const pages = [];
    for (const s of (job.sources || []).slice(0, 4)) { const img = await pageImage(s.url); if (img) pages.push({ url: img, credit: s.name || ownerOf(s.url) }); }
    meta = await anyPhoto(pages, work, dest, spare);
  }
  // A photo with text on it is still better than an AI illustration.
  if (!meta) meta = useSpare(dest, spare);
  // Last resort only: an illustration.
  if (!meta) {
    try { meta = await illustration(headline, work, dest); } catch (e) { console.log(`::warning::hero illustration for ${job.id}: ${e.message}`); }
  }
  if (!meta) throw new Error('no hero: no photo at least 1200 px wide and no illustration');
  // The desk writes alt text when it writes the site article (it looked at the photo).
  meta.alt = (meta.ai ? '' : plain(job.site_article?.hero_alt)) || await altText(dest, headline);
  fs.writeFileSync(path.join(outDir, 'hero.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

module.exports = { prepareHero, illustrateDraft, anyPhoto, pageImage, licenseFor, isNews };
