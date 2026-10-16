// Finds the clean original of a reposted clip (a podcast or interview cut that another account
// posted with its own logo) and the exact seconds it covers, so the Reel can use the original.
//
//   1. The repost's speech is transcribed with word timestamps (OpenAI, about half a cent a minute).
//   2. The original's YouTube captions (auto captions have a time for every word) are fetched.
//   3. Three-word sequences that appear in both give "original time minus clip time" offsets; the
//      offset most of them agree on is where the clip sits in the original. The share of the clip
//      that agrees is the confidence.
//   4. Only that section of the original is downloaded.
//
// Job fields (reel jobs): video.original = { url?: "https://www.youtube.com/watch?v=...",
// search?: ["Geoffrey Hinton 60 Minutes interview", ...] }. The result is saved in video.resolved.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }).toString();
  } catch (e) {
    const err = String(e.stderr || '').trim().split('\n').filter((l) => /error|warning/i.test(l)).slice(-2).join(' | ');
    throw new Error(`${cmd} failed: ${err || String(e.message).split('\n')[0]}`.slice(0, 500));
  }
}
const norm = (w) => String(w).toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]/g, '');
const ts = (s) => { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };

// ---------- Captions ----------
// WebVTT to a list of { w, t } (word, seconds). YouTube auto captions carry a time per word
// ("word<00:00:01.230><c> next</c>") and repeat the previous line in every cue; only the timed
// lines are read then. Manual captions get their words spread evenly over the cue.
function parseVtt(text) {
  const cues = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const m = lines[i].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!m) continue;
    cues.push({ start: ts(m[1]), end: ts(m[2]), lines: lines.slice(i + 1).filter((l) => l.trim()) });
  }
  const timed = cues.some((c) => c.lines.some((l) => /<\d\d:\d\d:\d\d\.\d+>/.test(l)));
  const words = [];
  for (const c of cues) {
    for (const line of c.lines) {
      if (timed) {
        if (!/<\d\d:\d\d:\d\d\.\d+>/.test(line)) continue;
        const parts = line.split(/<(\d\d:\d\d:\d\d\.\d+)>/);
        let t = c.start;
        for (let k = 0; k < parts.length; k++) {
          if (k % 2 === 1) { t = ts(parts[k]); continue; }
          for (const w of parts[k].replace(/<[^>]+>/g, ' ').split(/\s+/)) if (norm(w)) words.push({ w: norm(w), t });
        }
      } else {
        const ws = line.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => norm(w));
        ws.forEach((w, k) => words.push({ w: norm(w), t: c.start + ((c.end - c.start) * k) / Math.max(1, ws.length) }));
      }
    }
  }
  return words;
}

// ---------- Alignment ----------
// clip: [{ w, t, end? }] from the transcription; orig: [{ w, t }] from captions.
// Returns { start, end, score, matched, total, parts } or null.
function align(clip, orig, { minMatches = 6, minScore = 0.3 } = {}) {
  const c = clip.map((x) => ({ ...x, w: norm(x.w) })).filter((x) => x.w);
  const o = orig.filter((x) => x.w);
  if (c.length < 5 || o.length < 5) return null;
  const tri = (arr, i) => `${arr[i].w} ${arr[i + 1].w} ${arr[i + 2].w}`;
  const index = new Map();
  for (let i = 0; i + 2 < o.length; i++) {
    const k = tri(o, i);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(o[i].t);
  }
  const hits = []; // { d: offset, ct: clip time, ci: clip index }
  const total = c.length - 2;
  for (let i = 0; i + 2 < c.length; i++) for (const to of index.get(tri(c, i)) || []) hits.push({ d: to - c[i].t, ct: c[i].t, ci: i });
  if (!hits.length) return null;
  // The offset most clip words agree on (within 2.5 s: captions and transcription differ slightly).
  const groups = [];
  for (const h of [...hits].sort((a, b) => a.d - b.d)) {
    const g = groups.at(-1);
    if (g && h.d - g.lo <= 2.5) { g.items.push(h); } else groups.push({ lo: h.d, items: [h] });
  }
  const count = (g) => new Set(g.items.map((h) => h.ci)).size;
  groups.sort((a, b) => count(b) - count(a));
  const best = groups[0];
  const matched = count(best);
  const score = matched / total;
  if (matched < minMatches || score < minScore) return { score, matched, total, ok: false };
  const ds = best.items.map((h) => h.d).sort((a, b) => a - b);
  const d = ds[Math.floor(ds.length / 2)];
  const cis = best.items.map((h) => h.ci);
  const first = c[Math.min(...cis)];
  const lastI = Math.min(c.length - 1, Math.max(...cis) + 2);
  const last = c[lastI];
  // Other parts of the original the clip also uses (an edited clip): reported, not stitched.
  const parts = groups.slice(1).filter((g) => count(g) >= Math.max(4, matched * 0.25)).map((g) => ({ at: g.items[0].d + g.items[0].ct, words: count(g) }));
  return {
    ok: true,
    start: Math.max(0, d + first.t - 0.4),
    end: d + (last.end ?? last.t + 0.6) + 0.6,
    score, matched, total, parts,
  };
}

// ---------- Network steps (GitHub Actions) ----------
function extractAudio(video, out) {
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out], { timeout: 180000 });
  return out;
}
async function transcribe(audio) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), 'clip.mp3');
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(180000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`transcription: ${d.error?.message || res.status}`);
  return { text: d.text || '', words: (d.words || []).map((x) => ({ w: x.word, t: x.start, end: x.end })) };
}
function captions(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, 'cap');
  try {
    run('yt-dlp', ['--no-playlist', '--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt', '-o', base, url], { timeout: 120000 });
  } catch { /* checked below */ }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('cap') && f.endsWith('.vtt'));
  // Prefer the original-language auto captions ("en-orig" / "en"), they have word times.
  const pick = files.find((f) => /\.en-orig\.vtt$/.test(f)) || files.find((f) => /\.en\.vtt$/.test(f)) || files[0];
  return pick ? parseVtt(fs.readFileSync(path.join(dir, pick), 'utf8')) : [];
}
function meta(url) {
  const out = run('yt-dlp', ['--no-playlist', '--skip-download', '--print', '%(webpage_url)s\t%(title)s\t%(channel)s\t%(duration)s', url], { timeout: 90000 }).trim().split('\n').pop();
  const [u, title, channel, duration] = out.split('\t');
  return { url: u, title, channel, duration: Number(duration) || null };
}
function search(query, n = 4) {
  try {
    return run('yt-dlp', ['--flat-playlist', '--print', '%(url)s\t%(title)s\t%(channel)s\t%(duration)s', `ytsearch${n}:${query}`], { timeout: 90000 })
      .trim().split('\n').filter(Boolean).map((l) => { const [url, title, channel, duration] = l.split('\t'); return { url, title, channel, duration: Number(duration) || null }; });
  } catch { return []; }
}
// Downloads only [start, end] of a video (cut exactly, not at the nearest keyframe).
function downloadSection(url, start, end, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (s) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
  run('yt-dlp', ['--no-playlist', '--no-progress', '--restrict-filenames', '--download-sections', `*${f(start)}-${f(end)}`, '--force-keyframes-at-cuts',
    '-f', 'bv*[height<=1920][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=1920]+ba/b[height<=1920]/b', '--merge-output-format', 'mp4',
    '-o', path.join(dir, 'section.%(ext)s'), url], { timeout: 6 * 60 * 1000 });
  const file = fs.readdirSync(dir).find((x) => x.startsWith('section.') && !x.endsWith('.part'));
  if (!file) throw new Error('section download saved no file');
  return path.join(dir, file);
}

// Finds the original for a downloaded repost. Returns { resolved } or { reason }.
async function findOriginal(job, repostFile, dir) {
  const want = job.video?.original || {};
  fs.mkdirSync(dir, { recursive: true });
  const heard = await transcribe(extractAudio(repostFile, path.join(dir, 'clip.mp3')));
  if (heard.words.length < 8) return { reason: 'the clip has too little speech to match' };
  const candidates = [];
  if (want.url) candidates.push({ url: want.url, given: true });
  for (const q of [].concat(want.search || []).slice(0, 3)) for (const r of search(q)) if (!candidates.some((x) => x.url === r.url)) candidates.push(r);
  if (!candidates.length) return { reason: 'no original link or search words were given' };
  let best = null;
  const tried = [];
  for (const [k, cand] of candidates.slice(0, 9).entries()) {
    const words = captions(cand.url, path.join(dir, `c${k}`));
    if (!words.length) { tried.push(`${cand.title || cand.url}: no captions`); continue; }
    const m = align(heard.words, words);
    tried.push(`${cand.title || cand.url}: ${m ? Math.round(m.score * 100) : 0}%`);
    if (m?.ok && (!best || m.score > best.m.score)) best = { cand, m };
    if (best && best.m.score > 0.75) break;
  }
  if (!best) return { reason: `no matching original found (${tried.join('; ').slice(0, 400)})` };
  const info = best.cand.title && best.cand.channel ? best.cand : { ...best.cand, ...meta(best.cand.url) };
  return {
    resolved: {
      url: info.url || best.cand.url, title: info.title || null, channel: info.channel || null,
      start: Math.round(best.m.start * 100) / 100, end: Math.round(best.m.end * 100) / 100,
      score: Math.round(best.m.score * 100) / 100, edited: best.m.parts.length > 0, from_search: !best.cand.given,
    },
  };
}

module.exports = { parseVtt, align, findOriginal, downloadSection, captions, search, meta, transcribe, extractAudio };
