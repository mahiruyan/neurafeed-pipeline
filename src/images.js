// Downloads slide images for a job into out/<id>/src/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = 'NeuraFeedPipeline/0.1 (+https://neurafeedai.com; contact hello@neurafeedai.com)';

async function download(url, dest, minBytes = 15000) {
  // Built-in logo library ("assets/logos/claude.png") and images Mahir sent to the bot
  // ("inbox/uploads/<id>.jpg") are files in the repo.
  if (/^(assets|inbox\/uploads)\//.test(url) && !url.includes('..')) {
    fs.copyFileSync(path.join(__dirname, '..', url), dest);
    return dest;
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`Not an image (${type}) at ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`Image too small (${buf.length} bytes) at ${url}`);
  fs.writeFileSync(dest, buf);
  return dest;
}

// ---------- "Is this logo already in the photo?" ----------
// The vision model takes JPEG, PNG, GIF or WebP. Anything else (AVIF, SVG...) is converted first.
function imgData(f) {
  let buf = fs.readFileSync(f);
  const isWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  let type = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf.slice(0, 3).toString() === 'GIF' ? 'image/gif' : isWebp ? 'image/webp' : null;
  if (!type) {
    const out = `${f}.vision.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-frames:v', '1', out], { timeout: 60000 });
    buf = fs.readFileSync(out);
    type = 'image/png';
  }
  return `data:${type};base64,${buf.toString('base64')}`;
}

// Brand names a logo stands for, from the logo file or URL ("assets/logos/openai.png", "Google_G_logo.svg").
const BRANDS = { openai: ['OpenAI', 'ChatGPT'], claude: ['Claude', 'Anthropic'], anthropic: ['Anthropic', 'Claude'], meta: ['Meta', 'Facebook'], nvidia: ['NVIDIA'], apple: ['Apple'], x: ['X', 'xAI', 'Grok', 'Twitter'], xai: ['xAI', 'Grok', 'X'], grok: ['Grok', 'xAI', 'X'], google: ['Google', 'Gemini'], gemini: ['Gemini', 'Google'], microsoft: ['Microsoft', 'Copilot'] };
function brandOf(url) {
  const name = decodeURIComponent(String(url || '').split('/').pop() || '').replace(/^\d+px-/, '').replace(/\.(svg|png|jpe?g|webp)/gi, '').replace(/[_"%-]+/g, ' ').replace(/\b(logo|icon|symbol|wordmark|\d{4})\b/gi, '').trim();
  const first = (name.split(' ')[0] || name).toLowerCase();
  return BRANDS[name.toLowerCase()] || BRANDS[first] || [name.split(' ')[0] || name];
}
const normName = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

// Lists the brands a photo clearly shows (logos, symbols or written names). Needs OPENAI_API_KEY;
// without it nothing is checked and every logo is kept. Listing is a steadier task for the model
// than a yes/no question, and the matching is done in code. Well under a cent per photo, cached.
const seenCache = new Map();
async function brandsInPhoto(photo) {
  if (seenCache.has(photo)) return seenCache.get(photo);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const models = [process.env.OPENAI_VISION_MODEL || 'gpt-4.1', 'gpt-4o', 'gpt-4.1-mini'];
  let lastErr;
  for (const model of models) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, max_tokens: 150, temperature: 0, messages: [{ role: 'user', content: [
        { type: 'text', text: 'List every company or product brand that is clearly visible in this photo as a logo, symbol or written name (on a sign, screen, wall, device or product). Skip marks that are tiny, hidden or too blurry to recognize. Reply with a JSON array of brand names only, for example ["OpenAI", "Google Chrome"]. Reply [] if there are none.' },
        { type: 'image_url', image_url: { url: imgData(photo), detail: 'high' } },
      ] }] }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = d.choices?.[0]?.message?.content || '[]';
      let list = [];
      try { list = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      seenCache.set(photo, list);
      return list;
    }
    lastErr = new Error(d.error?.message || `HTTP ${res.status}`);
    if (!/model/i.test(lastErr.message)) break;
  }
  throw lastErr;
}

// True when the photo already shows the brand of this logo (its URL names the brand).
function brandMatches(seen, logoUrl) {
  const want = brandOf(logoUrl).map(normName).filter(Boolean);
  // Short names ("X", "HP") must match exactly; longer ones may sit inside ("Google Chrome").
  return (seen || []).map(normName).some((s) => s && want.some((w) => s === w || (w.length >= 3 && s.includes(w)) || (s.length >= 3 && w.includes(s))));
}
async function logoAlreadyVisible(photo, logoUrl) {
  const seen = await brandsInPhoto(photo);
  return seen ? brandMatches(seen, logoUrl) : false;
}

// Returns an array of local file paths, one per slide. A slide whose image fails
// falls back to the job's cover image so a render never ships with a blank area.
// AI-generated slide image (OpenAI image model). Needs OPENAI_API_KEY.
// Slide field: image.generate = "a prompt describing the scene".
// image.refs: optional list of image URLs (company logo, product photo, CEO photo, mascot) the
// model must use, so the result is recognizably about that company.
async function generate(prompt, dest, refs = [], size = '1024x1536') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing, cannot generate image');
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
  const quality = process.env.OPENAI_IMAGE_QUALITY || 'high';
  const files = [];
  for (let k = 0; k < refs.length; k++) {
    try {
      const f = await download(refs[k], `${dest}.ref${k}`, 500);
      const type = f && /\.png/i.test(refs[k]) ? 'image/png' : 'image/jpeg';
      files.push({ f, type });
    } catch (e) { /* a missing reference is skipped */ }
  }
  let res;
  if (files.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    files.forEach(({ f, type }, k) => form.append('image[]', new Blob([fs.readFileSync(f)], { type }), `ref${k}.${type === 'image/png' ? 'png' : 'jpg'}`));
    try {
      res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(280000) });
    } catch (e) {
      throw new Error(`OpenAI image edit request failed: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`);
    }
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
    });
  }
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`OpenAI image: ${data.error?.message || res.status}`);
  const item = data.data?.[0];
  if (item?.b64_json) fs.writeFileSync(dest, Buffer.from(item.b64_json, 'base64'));
  else if (item?.url) await download(item.url, dest);
  else throw new Error('OpenAI image: empty response');
  return dest;
}

// Slides that are fine without a picture (a post card shows one only when it has media).
const TEXT_ONLY = new Set(['post', 'prompt', 'summary', 'cta']);
async function fetchImages(job, outDir) {
  const srcDir = path.join(outDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const paths = [];
  const errors = [];
  for (let i = 0; i < job.slides.length; i++) {
    const s = job.slides[i];
    const urls = [].concat(s.image?.url || [], s.image?.fallback_urls || []);
    let saved = null;
    if (s.image?.generate) {
      try {
        saved = await generate(s.image.generate, path.join(srcDir, `${i + 1}.img`), s.image.refs || []);
      } catch (e) {
        errors.push(`slide ${i + 1}: ${e.message}`);
      }
    }
    for (const u of saved ? [] : urls) {
      try {
        saved = await download(u, path.join(srcDir, `${i + 1}.img`));
        break;
      } catch (e) {
        errors.push(`slide ${i + 1}: ${e.message}`);
      }
    }
    paths.push(saved);
  }
  const firstGood = paths.find(Boolean);
  if (!firstGood) throw new Error('No image could be downloaded for this job:\n' + errors.join('\n'));

  // Badges are optional: a badge that fails to download is simply left out. The slide's badge
  // list is trimmed the same way, so every remaining file keeps its own settings (side, fit, cutout).
  const badges = [];
  for (let i = 0; i < job.slides.length; i++) {
    const list = [];
    const kept = [];
    for (let j = 0; j < (job.slides[i].badges || []).length; j++) {
      const b = job.slides[i].badges[j];
      try {
        const raw = await download(b.url, path.join(srcDir, `${i + 1}-b${j + 1}.img`), 1000);
        let file = raw;
        if (b.cutout) {
          // Background removal (rembg), for mascots or products shown free on the photo.
          const png = path.join(srcDir, `${i + 1}-b${j + 1}.png`);
          try {
            execFileSync('python3', [path.join(__dirname, 'cutout.py'), raw, png], { stdio: 'pipe', timeout: 180000 });
            file = png;
          } catch (e) {
            errors.push(`slide ${i + 1} badge ${j + 1}: background removal failed, using the original`);
          }
        }
        // A logo the photo already shows clearly is not added a second time.
        const isLogo = (b.fit || 'contain') === 'contain' || b.shape === 'free' || b.cutout;
        if (isLogo && paths[i]) {
          const seen = await logoAlreadyVisible(paths[i], b.url).catch((e) => { errors.push(`slide ${i + 1} badge ${j + 1}: logo check skipped (${e.message})`); return false; });
          if (seen) { errors.push(`slide ${i + 1} badge ${j + 1}: left out, the photo already shows this logo`); continue; }
        }
        list.push(file);
        kept.push(b);
      } catch (e) {
        errors.push(`slide ${i + 1} badge ${j + 1}: ${e.message}`);
      }
    }
    if (job.slides[i].badges) job.slides[i].badges = kept;
    badges.push(list);
  }
  // Free logos/mascots on the cover without a fixed "top": find the empty part of the photo.
  const cover = job.slides[0];
  const free = (cover.badges || []).map((b, j) => ({ b, j })).filter(({ b }) => (b.shape === 'free' || b.cutout) && b.top === undefined);
  if (free.length && paths[0] && badges[0]?.length) {
    try {
      const sizes = free.map(({ b }) => Math.round(330 * (b.scale || 1)));
      const out = execFileSync('python3', [path.join(__dirname, 'place.py'), paths[0], cover.pos || 'center 30%', ...sizes.map(String)], { timeout: 180000 }).toString();
      JSON.parse(out).forEach((p, k) => Object.assign(free[k].b, p));
    } catch (e) {
      errors.push(`cover: automatic logo placement failed, using defaults`);
    }
  }
  // Avatars for post cards (the author's picture), optional.
  for (let i = 0; i < job.slides.length; i++) {
    const a = job.slides[i].author?.avatar;
    if (!a) continue;
    try { job.slides[i]._avatar = await download(a, path.join(srcDir, `${i + 1}-avatar.img`), 1000); } catch (e) { errors.push(`slide ${i + 1} avatar: ${e.message}`); }
  }
  // Text-only slides keep no picture; a missing picture elsewhere falls back to the cover's.
  return { paths: paths.map((p, i) => p || (TEXT_ONLY.has(job.slides[i].kind) ? null : firstGood)), badges, errors };
}

module.exports = { logoAlreadyVisible, brandsInPhoto, brandMatches, brandOf, download, fetchImages, generate, imgData };
