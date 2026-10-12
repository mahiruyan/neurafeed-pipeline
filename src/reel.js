// Reel pipeline: download a video, draw the NeuraFeed frame around it, export a 1080x1920 MP4.
//
// Layout depends on the source aspect ratio:
//   wide (>= 1.2)   -> header text on top, video full width in the middle, CTA below
//   square (>= 0.9) -> same, video 1080x1080
//   tall-ish (>=0.7)-> same, video 880 wide (4:5)
//   vertical        -> video fills the screen, header sits on a dark gradient at the top
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fontCss, hl, hlb, logo, fileUrl } = require('./templates');

const W = 1080;
const H = 1920;
const ACC = '#10a37f';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }).toString();
}

const UA = 'NeuraFeedPipeline/0.1 (+https://neurafeedai.com; contact hello@neurafeedai.com)';
const DIRECT = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i;

// Downloads the video at a post URL (X, Instagram, Reddit, YouTube, TikTok...) with yt-dlp.
// Direct video file links fall back to a plain download with a descriptive User-Agent.
function download(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'source.%(ext)s');
  let ytdlpError = null;
  try {
    run('yt-dlp', [
      '--no-playlist', '--no-progress', '--restrict-filenames',
      '-f', 'bv*[height<=1920][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=1920]+ba/b[height<=1920]/b',
      '--merge-output-format', 'mp4',
      '-o', out, url,
    ], { timeout: 5 * 60 * 1000 });
  } catch (e) {
    ytdlpError = e;
  }
  let file = fs.readdirSync(dir).find((f) => f.startsWith('source.') && !f.endsWith('.part'));
  if (!file && DIRECT.test(url)) {
    const ext = (url.match(DIRECT) || [])[1] || 'mp4';
    const dest = path.join(dir, `source.${ext}`);
    run('curl', ['-sSfL', '-A', UA, '--max-time', '300', '-o', dest, url]);
    file = path.basename(dest);
  }
  if (!file) throw ytdlpError || new Error('Download finished but no file was saved');
  return path.join(dir, file);
}

function probe(file) {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream in source');
  let w = v.width;
  let h = v.height;
  const rot = Math.abs(Number(v.tags?.rotate || v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation || 0));
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  return {
    w, h,
    duration: Number(j.format.duration || v.duration || 0),
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

function layoutFor(ar) {
  if (ar >= 1.2) return { mode: 'framed', vw: W, vh: Math.round(W / ar / 2) * 2 };
  if (ar >= 0.9) return { mode: 'framed', vw: W, vh: Math.round(W / ar / 2) * 2 };
  if (ar >= 0.7) return { mode: 'framed', vw: 880, vh: Math.round(880 / ar / 2) * 2 };
  return { mode: 'full', vw: W, vh: H };
}

const header = (job, color) => `
<div style="display:flex;align-items:center;gap:20px">
<img src="${logo}" style="width:92px;height:92px">
<div style="display:flex;flex-direction:column;gap:2px">
<div style="font-family:Poppins;font-size:36px;font-weight:600;color:#fff;line-height:1.2">Neurafeed AI</div>
<div style="font-family:Poppins;font-size:28px;color:${color};line-height:1.2">@neurafeed.ai</div>
</div></div>
<p style="margin:0;font-family:Poppins;font-size:${job.hook_size || 42}px;line-height:1.35;font-weight:500;color:#fff">${hlb(job.hook)}</p>`;

// HTML for the frame layer. The element #video marks where the video goes; it stays transparent.
function frameHtml(job, lay) {
  const credit = job.credit ? `<div style="font-family:Poppins;font-size:24px;color:#9aa1a7">Video: ${hl(job.credit)}</div>` : '';
  const cta = `<div style="font-family:Poppins;font-size:32px;color:#c3c8cc">Follow <span style="color:${ACC};font-weight:600">@neurafeed.ai</span> for daily AI news</div>`;
  if (lay.mode === 'full') {
    return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">
<div id="video" style="position:absolute;inset:0"></div>
<div style="position:absolute;top:0;left:0;width:${W}px;height:820px;background:linear-gradient(180deg,rgba(0,0,0,.9) 0%,rgba(0,0,0,.7) 55%,rgba(0,0,0,0) 100%)"></div>
<div style="position:absolute;top:220px;left:0;width:${W}px;box-sizing:border-box;padding:0 56px;display:flex;flex-direction:column;gap:28px">${header(job, '#c3c8cc')}</div>
<div style="position:absolute;left:40px;bottom:330px;font-family:Poppins;font-size:24px;color:#fff;opacity:.75">@neurafeed.ai</div>
</div>`;
  }
  return `<div style="width:${W}px;height:${H}px;display:flex;flex-direction:column;justify-content:center;gap:40px;overflow:hidden">
<div style="box-sizing:border-box;padding:0 56px;display:flex;flex-direction:column;gap:28px">${header(job, '#9aa1a7')}</div>
<div style="position:relative;align-self:center;width:${lay.vw}px;height:${lay.vh}px">
<div id="video" style="position:absolute;inset:0"></div>
<div style="position:absolute;left:28px;bottom:22px;font-family:Poppins;font-size:22px;color:#fff;opacity:.7">@neurafeed.ai</div>
</div>
<div style="box-sizing:border-box;padding:0 56px;display:flex;flex-direction:column;gap:14px">${credit}${cta}</div>
</div>`;
}

// Renders the frame as a PNG with a transparent hole and returns the hole's rectangle.
async function renderFrame(job, lay, outPng) {
  const puppeteer = require('puppeteer');
  const opts = { headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  const browser = await puppeteer.launch(opts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss} body{background:transparent}</style></head><body>${frameHtml(job, lay)}</body></html>`;
    const tmp = outPng.replace(/\.png$/, '.html');
    fs.writeFileSync(tmp, html);
    await page.goto(fileUrl(tmp), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Punch the hole: everything inside #video is transparent in the PNG.
    const rect = await page.evaluate(() => {
      const r = document.getElementById('video').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    await page.screenshot({ path: outPng, omitBackground: true });
    fs.rmSync(tmp, { force: true });
    return rect;
  } finally {
    await browser.close();
  }
}

// Draws the frame over the video and encodes an Instagram-friendly MP4 (H.264/AAC, 30 fps).
function compose(src, info, framePng, rect, out, job) {
  const start = Number(job.video?.start || 0);
  const maxLen = Number(job.video?.max_seconds || 90);
  const len = Math.max(3, Math.min(maxLen, (job.video?.end ? Number(job.video.end) : info.duration) - start));
  const filter = [
    `[1:v]scale=${rect.w}:${rect.h}:force_original_aspect_ratio=increase,crop=${rect.w}:${rect.h},setsar=1,fps=30[v]`,
    `[0:v][v]overlay=${rect.x}:${rect.y}:shortest=1[b]`,
    `[b][2:v]overlay=0:0,format=yuv420p[out]`,
  ].join(';');
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=30`,
    '-ss', String(start), '-t', String(len), '-i', src,
    '-i', framePng];
  // Silent sources get a silent audio track so Instagram always receives AAC audio.
  if (!info.hasAudio) args.push('-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=r=44100:cl=stereo');
  args.push('-filter_complex', filter, '-map', '[out]', '-map', info.hasAudio ? '1:a:0' : '3:a',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', '30', '-movflags', '+faststart', '-t', String(len), out);
  run('ffmpeg', args, { timeout: 10 * 60 * 1000 });
  return out;
}

async function renderReel(job, outDir, localSource) {
  fs.mkdirSync(outDir, { recursive: true });
  const src = localSource || download(job.video.url, path.join(outDir, 'src'));
  const info = probe(src);
  const lay = layoutFor(info.w / info.h);
  const framePng = path.join(outDir, 'frame.png');
  const rect = await renderFrame(job, lay, framePng);
  const out = path.join(outDir, 'reel.mp4');
  compose(src, info, framePng, rect, out, job);
  // A still of the finished Reel for previews and notifications.
  run('ffmpeg', ['-y', '-ss', '1', '-i', out, '-frames:v', '1', '-q:v', '3', path.join(outDir, 'preview.jpg')]);
  fs.rmSync(framePng, { force: true });
  fs.rmSync(path.join(outDir, 'src'), { recursive: true, force: true });
  return { video: out, preview: path.join(outDir, 'preview.jpg'), layout: lay.mode, source: info };
}

module.exports = { renderReel, layoutFor };

// CLI test: node src/reel.js jobs/<id>.json [local-video.mp4]
if (require.main === module) {
  (async () => {
    const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const r = await renderReel(job, path.join(__dirname, '..', 'out', job.id), process.argv[3]);
    console.log(JSON.stringify(r, null, 2));
  })().catch((e) => { console.error(e); process.exit(1); });
}
