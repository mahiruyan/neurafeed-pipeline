// Renders before/after cover samples: samples/covers/<id>.json = { id, old: slide, new: slide }.
// The old cover uses its real photo (no generated image) in the current style, the new one style v2.
// Usage: node tools/cover-samples.js <outdir>
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { fetchImages } = require('../src/images');
const { renderJob } = require('../src/render');
const OUT = process.argv[2] || 'cover-samples';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync('samples/covers').filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join('samples/covers', f), 'utf8'));
    const shots = [];
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
