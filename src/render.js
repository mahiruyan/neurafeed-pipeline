// Renders a job's slides to out/<id>/<n>.jpg using headless Chrome.
const fs = require('fs');
const path = require('path');
const { page: buildPage, fileUrl } = require('./templates');

async function launch() {
  const puppeteer = require('puppeteer');
  const opts = { headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  return puppeteer.launch(opts);
}

// A white or very light logo (Apple, OpenAI...) disappears on the white round badge. Measure the
// logo's own pixels and give light ones a near-black circle instead. Only for round "contain" badges
// without an explicit "bg".
async function logoLightness(tab, file) {
  const buf = fs.readFileSync(file);
  const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0x52 ? 'image/webp' : buf[0] === 0x47 ? 'image/gif' : buf.slice(0, 5).toString().includes('<') ? 'image/svg+xml' : 'image/jpeg';
  const url = `data:${type};base64,${buf.toString('base64')}`;
  return tab.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let sum = 0; let n = 0;
    for (let k = 0; k < d.length; k += 4) {
      if (d[k + 3] < 128) continue;
      const l = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      sum += l; n++;
    }
    return { light: n ? sum / n : 255, coverage: n / (64 * 64) };
  }, url);
}
async function darkBackForLightLogos(tab, slide, files) {
  if (!slide.badges?.length || !files.length) return slide;
  const badges = await Promise.all(slide.badges.map(async (b, k) => {
    const round = !(b.shape === 'free' || (b.cutout && !b.shape)) && (b.fit || 'contain') === 'contain';
    if (!round || b.bg || !files[k]) return b;
    const m = await logoLightness(tab, files[k]).catch(() => null);
    // Light mark on transparency (not a full white square) -> dark circle.
    return m && m.light > 200 && m.coverage < 0.9 ? { ...b, bg: '#111111' } : b;
  }));
  return { ...slide, badges };
}

async function renderJob(job, imagePaths, outDir, badgePaths = []) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const files = [];
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1080, height: 1350 });
    for (let i = 0; i < job.slides.length; i++) {
      let slide = job.format === 'single' ? { ...job.slides[i], single: true } : { ...job.slides[i] };
      slide._n = i + 1;
      slide._total = job.slides.length;
      if (job._account) slide._account = job._account;
      slide = await darkBackForLightLogos(tab, slide, badgePaths[i] || []);
      const html = buildPage(slide, imagePaths[i] ? fileUrl(imagePaths[i]) : null, (badgePaths[i] || []).map(fileUrl));
      const htmlFile = path.join(outDir, '_slide.html');
      fs.writeFileSync(htmlFile, html);
      await tab.goto(fileUrl(htmlFile), { waitUntil: 'load' });
      await tab.evaluate(() => document.fonts.ready);
      // Instagram's API accepts JPEG only.
      const out = path.join(outDir, `${i + 1}.jpg`);
      await tab.screenshot({ path: out, type: 'jpeg', quality: 92 });
      files.push(out);
    }
    fs.rmSync(path.join(outDir, '_slide.html'), { force: true });
  } finally {
    await browser.close();
  }
  return files;
}

module.exports = { renderJob };

// CLI: node src/render.js jobs/<id>.json [localImageDir]
if (require.main === module) {
  (async () => {
    const jobFile = process.argv[2];
    const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    const outDir = path.join(__dirname, '..', 'out', job.id);
    let imgs;
    let badges = [];
    if (process.argv[3]) {
      // Local test mode: <dir>/<n>.jpg for slides and <dir>/<n>-b<m>.png for badges.
      const dir = process.argv[3];
      imgs = job.slides.map((_, i) => path.resolve(dir, `${i + 1}.jpg`));
      badges = job.slides.map((s, i) => (s.badges || []).map((_, j) => path.resolve(dir, `${i + 1}-b${j + 1}.png`)).filter((f) => fs.existsSync(f)));
    } else {
      const r = await require('./images').fetchImages(job, outDir);
      imgs = r.paths;
      badges = r.badges;
    }
    const files = await renderJob(job, imgs, outDir, badges);
    console.log(files.join('\n'));
  })().catch((e) => { console.error(e); process.exit(1); });
}
