// Renders a job's slides to out/<id>/<n>.png using headless Chrome.
const fs = require('fs');
const path = require('path');
const { page: buildPage, fileUrl } = require('./templates');

async function launch() {
  const puppeteer = require('puppeteer');
  const opts = { headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  return puppeteer.launch(opts);
}

async function renderJob(job, imagePaths, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const files = [];
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1080, height: 1350 });
    for (let i = 0; i < job.slides.length; i++) {
      const html = buildPage(job.slides[i], fileUrl(imagePaths[i]));
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
    if (process.argv[3]) {
      imgs = job.slides.map((_, i) => path.resolve(process.argv[3], `${i + 1}.jpg`));
    } else {
      imgs = (await require('./images').fetchImages(job, outDir)).paths;
    }
    const files = await renderJob(job, imgs, outDir);
    console.log(files.join('\n'));
  })().catch((e) => { console.error(e); process.exit(1); });
}
