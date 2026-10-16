// Manual check of the "photo already shows this logo" test on real past covers. Read only.
// Usage: node scripts/logo-check.js <job id>...
const fs = require('fs');
const os = require('os');
const path = require('path');
const { brandsInPhoto, brandMatches, brandOf, download } = require('../src/images');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  for (const id of process.argv.slice(2)) try {
    const job = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'jobs', `${id}.json`), 'utf8'));
    const cover = job.slides[0];
    const photo = await download(cover.image.url, path.join(tmp, `${id}.img`));
    const seen = await brandsInPhoto(photo);
    for (const b of cover.badges || []) {
      console.log(`::notice::${id} | ${brandOf(b.url).join('/')} | already in photo: ${brandMatches(seen, b.url)} | photo shows ${JSON.stringify(seen)}`);
    }
  } catch (e) { console.log(`::warning::${id}: ${e.message}`); }
})().catch((e) => console.log(`::error::${e.stack || e}`));
