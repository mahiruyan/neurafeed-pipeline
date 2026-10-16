// Manual check of the "photo already shows this logo" test on real past covers. Read only.
// Usage: node scripts/logo-check.js <job id>...
const fs = require('fs');
const os = require('os');
const path = require('path');
const { logoAlreadyVisible } = require('../src/images');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  for (const id of process.argv.slice(2)) {
    const job = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'jobs', `${id}.json`), 'utf8'));
    const cover = job.slides[0];
    const res = await fetch(cover.image.url, { headers: { 'User-Agent': 'Mozilla/5.0 neurafeed' } });
    const photo = path.join(tmp, `${id}.img`);
    fs.writeFileSync(photo, Buffer.from(await res.arrayBuffer()));
    for (const b of cover.badges || []) {
      let logo = b.url;
      if (/^https?:/.test(logo)) { const r = await fetch(logo, { headers: { 'User-Agent': 'Mozilla/5.0 neurafeed' } }); logo = path.join(tmp, 'logo.png'); fs.writeFileSync(logo, Buffer.from(await r.arrayBuffer())); } else logo = path.join(__dirname, '..', logo);
      const seen = await logoAlreadyVisible(photo, logo).catch((e) => `error: ${e.message}`);
      console.log(`::notice::${id} | ${path.basename(b.url)} | already in photo: ${seen}`);
    }
  }
})();
