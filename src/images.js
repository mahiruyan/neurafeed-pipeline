// Downloads slide images for a job into out/<id>/src/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = 'NeuraFeedPipeline/0.1 (+https://neurafeedai.com; contact hello@neurafeedai.com)';

async function download(url, dest, minBytes = 15000) {
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
// AI-generated slide image (OpenAI image model). Needs OPENAI_API_KEY.
// Slide field: image.generate = "a prompt describing the scene".
// image.refs: optional list of image URLs (company logo, product photo, CEO photo, mascot) the
// model must use, so the result is recognizably about that company.
async function generate(prompt, dest, refs = []) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing, cannot generate image');
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const quality = process.env.OPENAI_IMAGE_QUALITY || 'medium';
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

  // Badges are optional: a badge that fails to download is simply left out.
  const badges = [];
  for (let i = 0; i < job.slides.length; i++) {
    const list = [];
    for (let j = 0; j < (job.slides[i].badges || []).length; j++) {
      const b = job.slides[i].badges[j];
      try {
        const raw = await download(b.url, path.join(srcDir, `${i + 1}-b${j + 1}.img`), 1000);
        if (b.cutout) {
          // Background removal (rembg), for mascots or products shown free on the photo.
          const png = path.join(srcDir, `${i + 1}-b${j + 1}.png`);
          try {
            execFileSync('python3', [path.join(__dirname, 'cutout.py'), raw, png], { stdio: 'pipe', timeout: 180000 });
            list.push(png);
          } catch (e) {
            errors.push(`slide ${i + 1} badge ${j + 1}: background removal failed, using the original`);
            list.push(raw);
          }
        } else {
          list.push(raw);
        }
      } catch (e) {
        errors.push(`slide ${i + 1} badge ${j + 1}: ${e.message}`);
      }
    }
    badges.push(list);
  }
  return { paths: paths.map((p) => p || firstGood), badges, errors };
}

module.exports = { fetchImages };
