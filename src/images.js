// Downloads slide images for a job into out/<id>/src/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = 'NeuraFeedPipeline/0.1 (+https://neurafeedai.com; contact hello@neurafeedai.com)';

async function download(url, dest, minBytes = 15000) {
  // Built-in logo library: "assets/logos/claude.png" and friends.
  if (url.startsWith('assets/')) {
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

// Returns an array of local file paths, one per slide. A slide whose image fails
// falls back to the job's cover image so a render never ships with a blank area.
// Asks a small vision model whether the photo already shows the logo (or the brand's name)
// clearly. Needs OPENAI_API_KEY; without it every logo is kept. Costs a fraction of a cent.
// The vision model takes JPEG, PNG, GIF or WebP. Anything else (AVIF, SVG...) is converted first.
// A logo is flattened onto mid gray first: a white or black mark on transparency is invisible
// to the model otherwise.
function onGray(f) {
  const out = `${f}.gray.png`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-filter_complex',
    "color=c=0x808080:s=512x512[bg];[0:v]scale=440:440:force_original_aspect_ratio=decrease[l];[bg][l]overlay=(W-w)/2:(H-h)/2:format=auto", '-frames:v', '1', out], { timeout: 60000 });
  return out;
}
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
// Brand name for the question, from the logo file or URL ("assets/logos/openai.png", "Google_G_logo.svg").
const BRANDS = { openai: 'OpenAI" or "ChatGPT', claude: 'Claude" or "Anthropic', anthropic: 'Anthropic" or "Claude', meta: 'Meta', nvidia: 'NVIDIA', apple: 'Apple' };
function brandOf(url) {
  const name = decodeURIComponent(String(url || '').split('/').pop() || '').replace(/^\d+px-/, '').replace(/\.(svg|png|jpe?g|webp)/gi, '').replace(/[_"%-]+/g, ' ').replace(/\b(logo|icon|symbol|wordmark|\d{4})\b/gi, '').trim();
  return BRANDS[name.toLowerCase()] || name || 'the company';
}
async function logoAlreadyVisible(photo, logo, brand = 'the company') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  const models = [process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini', 'gpt-4o-mini'];
  let grayLogo = logo;
  try { grayLogo = onGray(logo); } catch { /* no ffmpeg: send as is */ }
  let lastErr;
  for (const model of models) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, max_tokens: 3, temperature: 0, messages: [{ role: 'user', content: [
        { type: 'text', text: `Image 1 is a news photo. Image 2 is the logo of "${brand}". Answer yes if image 1 already clearly shows that brand: this logo, any other logo or symbol of it, or the word "${brand}" written large enough to read (on a sign, screen, wall or product). Small, hidden or blurry marks do not count. Answer only yes or no.` },
        { type: 'image_url', image_url: { url: imgData(photo), detail: 'high' } },
        { type: 'image_url', image_url: { url: imgData(grayLogo), detail: 'low' } },
      ] }] }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) return /^\s*yes/i.test(d.choices?.[0]?.message?.content || '');
    lastErr = new Error(d.error?.message || `HTTP ${res.status}`);
    if (!/model/i.test(lastErr.message)) break;
  }
  throw lastErr;
}

// AI-generated slide image (OpenAI image model). Needs OPENAI_API_KEY.
// Slide field: image.generate = "a prompt describing the scene".
// image.refs: optional list of image URLs (company logo, product photo, CEO photo, mascot) the
// model must use, so the result is recognizably about that company.
async function generate(prompt, dest, refs = []) {
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
    form.append('size', '1024x1536');
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
      body: JSON.stringify({ model, prompt, size: '1024x1536', quality, n: 1 }),
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
          const seen = await logoAlreadyVisible(paths[i], file, brandOf(b.url)).catch((e) => { errors.push(`slide ${i + 1} badge ${j + 1}: logo check skipped (${e.message})`); return false; });
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
  return { paths: paths.map((p) => p || firstGood), badges, errors };
}

module.exports = { logoAlreadyVisible, brandOf, download, fetchImages };
