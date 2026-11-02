// Renders before/after cover samples: samples/covers/<id>.json = { id, old: slide, new: slide }.
// The old cover uses its real photo (no generated image) in the current style, the new one style v2.
// Usage: node tools/cover-samples.js <outdir>
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { fetchImages } = require('../src/images');
const { renderJob } = require('../src/render');
const OUT = process.argv[2] || 'cover-samples';
// First Wikimedia Commons photo (JPEG, at least 1000 px wide) for a search, as a ready thumbnail URL.
async function commons(q) {
  const u = q.startsWith('File:')
    ? `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1280`
    : `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1280`;
  const d = await (await fetch(u, { headers: { 'User-Agent': 'NeuraFeedPipeline/0.1 (hello@neurafeedai.com)' } })).json();
  const pages = Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const hit = pages.map((p) => p.imageinfo?.[0]).find((i) => i && i.mime === 'image/jpeg' && i.width >= 1000);
  console.log(`::notice::commons "${q}": ${hit ? hit.descriptionurl : 'none'}`);
  return hit?.thumburl || null;
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync('samples/covers').filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join('samples/covers', f), 'utf8'));
    const shots = [];
    if (s.new.image?.commons) s.new.image.url = await commons(s.new.image.commons) || s.new.image.url;
    for (const [tag, slide] of [['old', s.old], ['new', { ...s.new, style: 'v2' }]]) {
      const dir = path.join('/tmp/cs', s.id, tag);
      const job = { id: `${s.id}-${tag}`, slides: [slide] };
      try {
        const img = await fetchImages(job, dir);
        const files = await renderJob(job, img.paths, dir, img.badges);
        shots.push(files[0]);
      } catch (e) { console.log(`::error::${s.id} ${tag}: ${e.message}`); }
    }
    if (shots.length === 2) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', shots[0], '-i', shots[1], '-filter_complex', '[0][1]hstack=2,scale=1440:-2', '-q:v', '3', path.join(OUT, `${s.id}.jpg`)]);
    console.log(`::notice::${s.id}: ${shots.length} rendered`);
  }
})();
