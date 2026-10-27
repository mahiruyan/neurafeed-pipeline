// node video/sample/thumb.js <a|b> <image url> <out.jpg>
const path = require('path'); const puppeteer = require('puppeteer');
(async () => {
  const [v, img, out] = process.argv.slice(2);
  const b = await puppeteer.launch({ args: ['--no-sandbox'] }); const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  await p.evaluateOnNewDocument((d) => { window.DATA = d; }, { v, img });
  await p.goto('file://' + path.join(__dirname, 'thumb.html'), { waitUntil: 'networkidle0', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: out, type: 'jpeg', quality: 92 }); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
