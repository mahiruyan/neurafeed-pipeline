// Renders sample.html frame by frame (deterministic window.render(t)) and muxes the narration.
// Usage: node video/sample/render.js <dir with voice.mp3+timing.json> <theme dark|light> <walkout image url> <out.mp4>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

async function main() {
  const [dir, theme, walkout, out] = process.argv.slice(2);
  const script = JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8'));
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  const data = { theme, timing, captions: script.captions, images: { ...script.images, walkout: walkout || script.images.walkout } };
  const fps = 30; const dur = timing.duration + 1.6;
  const frames = path.join(dir, `frames-${theme}`); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluateOnNewDocument((d) => { window.DATA = d; }, data);
  await page.goto('file://' + path.join(__dirname, 'sample.html'), { waitUntil: 'networkidle0', timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  // make sure background images are loaded
  await page.evaluate(async (urls) => { await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; }))); }, Object.values(data.images));
  const n = Math.ceil(dur * fps);
  for (let f = 0; f < n; f++) {
    await page.evaluate((t) => window.render(t), f / fps);
    await page.screenshot({ path: path.join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
  }
  await browser.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, '%05d.jpg'),
    '-i', path.join(dir, 'voice.mp3'), '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]);
  console.log('wrote', out, n, 'frames');
}
main().catch((e) => { console.error(e); process.exit(1); });
