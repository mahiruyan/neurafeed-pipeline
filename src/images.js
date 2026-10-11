// Downloads slide images for a job into out/<id>/src/.
const fs = require('fs');
const path = require('path');

const UA = 'NeuraFeedPipeline/0.1 (+https://neurafeedai.com; contact hello@neurafeedai.com)';

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`Not an image (${type}) at ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 15000) throw new Error(`Image too small (${buf.length} bytes) at ${url}`);
  fs.writeFileSync(dest, buf);
  return dest;
}

// Returns an array of local file paths, one per slide. A slide whose image fails
// falls back to the job's cover image so a render never ships with a blank area.
async function fetchImages(job, outDir) {
  const srcDir = path.join(outDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const paths = [];
  const errors = [];
  for (let i = 0; i < job.slides.length; i++) {
    const s = job.slides[i];
    const urls = [].concat(s.image?.url || [], s.image?.fallback_urls || []);
    let saved = null;
    for (const u of urls) {
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
  return { paths: paths.map((p) => p || firstGood), errors };
}

module.exports = { fetchImages };
