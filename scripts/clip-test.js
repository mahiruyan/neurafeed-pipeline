// Live, read-only test of src/clip.js: makes a fake "repost" (a cut of a real YouTube video with
// another page's logo box, zoomed), then checks that the original and the seconds are found.
// Nothing is posted. Usage: node scripts/clip-test.js <youtube url> <start s> <seconds> "<search words>"
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const clip = require('../src/clip');

(async () => {
  const [url, start, len, query] = process.argv.slice(2);
  const s = Number(start); const e = s + Number(len);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  const cut = clip.downloadSection(url, s, e, path.join(dir, 'cut'));
  const repost = path.join(dir, 'repost.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', cut, '-vf',
    'scale=iw*1.12:ih*1.12,crop=iw/1.12:ih/1.12,drawbox=x=20:y=20:w=220:h=80:color=purple@0.9:t=fill', '-c:a', 'aac', repost]);
  console.log(`::notice::fake repost made: ${len}s from ${s}s`);
  for (const [name, original] of [['with link', { url, search: [query] }], ['search only', { search: [query] }]]) {
    const t0 = Date.now();
    const r = await clip.findOriginal({ video: { original } }, repost, path.join(dir, name.replace(' ', '-'))).catch((err) => ({ reason: err.message }));
    const secs = Math.round((Date.now() - t0) / 1000);
    if (r.resolved) {
      const off = Math.abs(r.resolved.start - s);
      console.log(`::notice::${name}: found "${r.resolved.title}" (${r.resolved.channel}) ${r.resolved.start}s to ${r.resolved.end}s, truth ${s}s to ${e}s, start off by ${off.toFixed(1)}s, match ${Math.round(r.resolved.score * 100)}%, ${secs}s`);
      if (name === 'with link') {
        const sec = clip.downloadSection(r.resolved.url, r.resolved.start, r.resolved.end, path.join(dir, 'final'));
        const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'csv=p=0', sec]).toString().replace(/\n/g, ' ');
        console.log(`::notice::final section download ok: ${d}`);
      }
    } else console.log(`::warning::${name}: not found (${r.reason}), ${secs}s`);
  }
})().catch((err) => { console.log(`::error::${err.stack || err}`); process.exit(1); });
