// One-off: prepare website hero images for desk-feed stories rendered before hero.js existed.
// Usage: node src/hero-backfill.js   (needs OPENAI_API_KEY for illustrations)
const fs = require('fs');
const path = require('path');
const { ROOT, loadJob } = require('./state');
const { deskItems } = require('./deskfeed');
const { prepareHero } = require('./hero');

(async () => {
  let made = 0;
  for (const item of deskItems()) {
    const outDir = path.join(ROOT, 'out', item.id);
    // REDO=photos redoes reused photos (fixes credits); illustrations are kept (they cost money).
    const existing = fs.existsSync(path.join(outDir, 'hero.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'hero.json'), 'utf8')) : null;
    // ONLY=<id>[,<id>] redoes just those stories.
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(item.id)) continue;
    if (existing && !process.env.ONLY && !(process.env.REDO === 'photos' && !existing.ai)) continue;
    const job = loadJob(item.id);
    if (!job) continue;
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const meta = await prepareHero(job, outDir);
      fs.rmSync(path.join(outDir, 'src'), { recursive: true, force: true });
      if (meta) { made++; console.log(`hero ${item.id}: ${meta.ai ? 'illustration' : meta.license} ${meta.width}x${meta.height}`); }
    } catch (e) { console.log(`::warning::hero ${item.id}: ${e.message}`); }
  }
  console.log(`heroes prepared: ${made}`);
})();
