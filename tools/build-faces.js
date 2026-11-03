// Builds the face library (assets/people/index.json): for each person in assets/people/people.json,
// up to 6 strong real photos from Wikimedia Commons (free licenses), checked by a vision model
// (one main person, clear face, no text or watermark, good as a news cover) with their expression,
// so a cover can pick a serious face for bad news and a smile for a record. Contact sheets go to
// <review dir> for Mahir to look at. Usage: node tools/build-faces.js <review dir> [slug,slug]
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { askFalVision, download } = require('../src/images');
const ROOT = path.join(__dirname, '..');
const REVIEW = process.argv[2] || '/tmp/people-review';
const ONLY = (process.argv[3] || '').split(',').filter(Boolean);
const UA = { 'User-Agent': 'NeuraFeedPipeline/0.1 (https://neurafeedai.com; hello@neurafeedai.com)' };
let warned = 0;
const warn = (m) => { if (warned++ < 6) console.log(`::warning::${m.slice(0, 300)}`); };
const plain = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function candidates(name) {
  const q = `intitle:"${name}" filemime:image/jpeg`;
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1280`;
  const d = await (await fetch(u, { headers: UA })).json();
  return Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index).map((p) => {
    const i = p.imageinfo?.[0] || {}; const m = i.extmetadata || {};
    const year = Number(String(m.DateTimeOriginal?.value || m.DateTime?.value || '').match(/(19|20)\d\d/)?.[0]) || null;
    return { title: p.title, page: i.descriptionurl, url: i.thumburl, width: i.width, height: i.height, year,
      credit: `${plain(m.Artist?.value) || 'Wikimedia Commons'} / ${plain(m.LicenseShortName?.value) || 'see Commons'}`, license: plain(m.LicenseShortName?.value) };
  }).filter((c) => c.url && c.width >= 1000 && /(PD|public domain|CC|GFDL)/i.test(c.license));
}

// Web candidates (MODE=web): news and press photos from a Bing image search (large, face filter).
// Stock sites whose previews carry watermarks are left out. Credit = the site the photo is on.
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };
const STOCK = /(gettyimages|istockphoto|alamy|shutterstock|dreamstime|depositphotos|123rf|agefotostock|bigstock|pond5|adobestock|stock\.adobe|imago-images|zumapress|pinterest|pinimg|lookaside|fbsbx|instagram|tiktok|redd\.it|wikimedia)/i;
const unent = (t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function bing(q) {
  const u = `https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=35&mmasync=1&qft=${encodeURIComponent('+filterui:imagesize-large+filterui:face-face')}`;
  const html = await (await fetch(u, { headers: BROWSER })).text();
  const out = [];
  for (const m of html.matchAll(/\sm="([^"]+)"/g)) {
    try { const j = JSON.parse(unent(m[1])); if (j.murl) out.push({ url: j.murl, page: j.purl, title: j.t || '' }); } catch { /* not a result */ }
  }
  return out;
}
async function ddg(q) {
  const page = await (await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`, { headers: BROWSER })).text();
  const vqd = page.match(/vqd=["']?([\d-]+)/)?.[1];
  if (!vqd) return [];
  const r = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=size:Large,,,,,&p=1`, { headers: { ...BROWSER, Referer: 'https://duckduckgo.com/' } });
  const j = await r.json().catch(() => ({}));
  return (j.results || []).map((x) => ({ url: x.image, page: x.url, title: x.title || '' }));
}
// Lead photos of recent news articles about the person (og:image), from the Bing News RSS feed.
async function newsPhotos(name) {
  const xml = await (await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(`"${name}"`)}&format=rss&count=40`, { headers: BROWSER })).text();
  const links = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>/g)].map((m) => ({ title: unent(m[1]), link: unent(m[2]).trim() }));
  const out = [];
  for (const l of links.slice(0, 30)) {
    let page = l.link; const u = page.match(/[?&]url=([^&]+)/); if (u) page = decodeURIComponent(u[1]);
    try {
      const html = await (await fetch(page, { headers: BROWSER, signal: AbortSignal.timeout(12000) })).text();
      const img = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)?.[1];
      if (img) out.push({ url: unent(img), page, title: l.title });
    } catch { /* skip this article */ }
  }
  return out;
}
async function webCandidates(name) {
  const seen = new Set(); const all = [];
  // Keep only results that name the person (title or page), so loose matches (maps, calendars) drop out.
  const last = name.split(' ').pop().toLowerCase();
  const sources = [['news', () => newsPhotos(name)], ['bing', () => bing(name)], ['ddg', () => ddg(name)], ['bing2', () => bing(`${name} interview`)], ['ddg2', () => ddg(`${name} on stage`)]];
  const counts = [];
  for (const [label, run] of sources) {
    let r = []; try { r = await run(); } catch (e) { warn(`${label} ${name}: ${e.message}`); }
    let kept = 0;
    for (const c of r) {
      if (!c.url || !/^https?:/.test(c.url)) continue;
      const key = c.url.split('?')[0];
      if (seen.has(key) || STOCK.test(c.url) || STOCK.test(c.page || '')) continue;
      if (!`${c.title} ${c.page} ${c.url}`.toLowerCase().includes(last)) continue;
      seen.add(key); kept++;
      let host = ''; try { host = new URL(c.page || c.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
      all.push({ ...c, credit: host ? `via ${host}` : 'web', license: 'web', from: label });
    }
    counts.push(`${label} ${r.length}/${kept}`);
  }
  console.log(`::notice::${name} sources: ${counts.join(', ')}`);
  return all;
}
async function webDownload(url, file) {
  const res = await fetch(url, { headers: { ...BROWSER, Accept: 'image/avif,image/webp,image/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!(res.headers.get('content-type') || '').startsWith('image/')) throw new Error('not an image');
  const raw = file + '.raw'; fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', raw]).toString().trim().split(',').map(Number);
  if (!(w >= 900 && h >= 700)) throw new Error(`too small ${w}x${h}`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-frames:v', '1', '-q:v', '3', file]);
  return { width: w, height: h };
}

const PROMPT = (name) => `This photo is said to show ${name}. Do not identify anyone; judge only what you see. Reply with JSON only:
{"one_main_person": true|false (one person clearly the subject, others small or blurred), "face": "large"|"medium"|"small"|"none" (size of that person's face in the frame), "expression": "serious"|"smiling"|"laughing"|"surprised"|"worried"|"angry"|"speaking"|"neutral", "sharp": true|false, "text_or_watermark": true|false (large text, captions, logos or watermarks on the photo itself, not small text on clothes or a badge), "cover_quality": 1-10 (how strong this is as the photo on a news cover: light, sharpness, emotion, a clean background), "face_y": 0-1 (vertical center of the face, 0 = top)}`;

async function judge(c, name, dir) {
  const file = path.join(dir, `${c.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.jpg`);
  try { await download(c.url, file, 30000); } catch (e) { warn(`download ${c.title}: ${e.message}`); return null; }
  try {
    const t = await askFalVision(file, PROMPT(name), 200);
    const v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    return { ...c, file, ...v };
  } catch (e) { warn(`vision ${c.title}: ${e.message}`); return null; }
}

(async () => {
  const people = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/people/people.json'), 'utf8'));
  const outFile = path.join(ROOT, 'assets/people/index.json');
  const index = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  fs.mkdirSync(REVIEW, { recursive: true });
  for (const p of people) {
    if (ONLY.length && !ONLY.includes(p.slug)) continue;
    const dir = path.join('/tmp/faces', p.slug); fs.mkdirSync(dir, { recursive: true });
    let cands = [];
    try { cands = process.env.MODE === 'web' ? (await webCandidates(p.name)).slice(0, 60) : (await candidates(p.name)).slice(0, 18); } catch (e) { console.log(`::warning::${p.slug}: ${e.message}`); }
    if (process.env.MODE === 'sheet' || process.env.MODE === 'web') {
      // Review by eye: a numbered grid of every candidate and their details, no vision model.
      const got = [];
      for (const c of cands) {
        if (got.length >= 30) break;
        const file = path.join(dir, `${got.length + 1}.jpg`);
        try {
          if (process.env.MODE === 'web') { const size = await webDownload(c.url, file); got.push({ ...c, ...size, n: got.length + 1, file }); } else { await download(c.url, file, 30000); got.push({ ...c, n: got.length + 1, file }); }
        } catch (e) { warn(`download ${c.title || c.url}: ${e.message}`); }
      }
      fs.writeFileSync(path.join(REVIEW, `${p.slug}.json`), JSON.stringify(got.map(({ file, ...c }) => c), null, 2));
      if (got.length) {
        const cell = (i) => `[${i}]scale=300:375:force_original_aspect_ratio=increase,crop=300:375,drawtext=text='${i + 1}':x=10:y=10:fontsize=44:fontcolor=yellow:box=1:boxcolor=black@0.7:boxborderw=6[v${i}]`;
        const cols = 6; const rows = Math.ceil(got.length / cols);
        const pads = Array.from({ length: rows * cols - got.length }, (_, k) => `color=black:s=300x375:d=1[p${k}]`);
        const labels = got.map((_, i) => `[v${i}]`).concat(pads.map((_, k) => `[p${k}]`));
        const filter = [...got.map((_, i) => cell(i)), ...pads, `${labels.join('')}xstack=inputs=${rows * cols}:layout=${Array.from({ length: rows * cols }, (_, i) => `${(i % cols) * 300}_${Math.floor(i / cols) * 375}`).join('|')}`].join(';');
        try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...got.flatMap((g) => ['-i', g.file]), '-filter_complex', filter, '-frames:v', '1', '-q:v', '5', path.join(REVIEW, `${p.slug}.jpg`)]); } catch (e) { warn(`sheet ${p.slug}: ${e.message}`); }
      }
      console.log(`::notice::${p.name}: ${got.length} candidates in the sheet`);
      continue;
    }
    const judged = [];
    for (const c of cands) { const j = await judge(c, p.name, dir); if (j) judged.push(j); }
    const good = judged.filter((j) => j.one_main_person && ['large', 'medium'].includes(j.face) && j.sharp && !j.text_or_watermark && j.cover_quality >= 6)
      .sort((a, b) => (b.cover_quality - a.cover_quality) || ((b.year || 0) - (a.year || 0)));
    // Up to 6, at most 2 of the same expression, so there is a face for every kind of story.
    const pick = []; const per = {};
    for (const g of good) { if (pick.length >= 6) break; if ((per[g.expression] || 0) >= 2) continue; per[g.expression] = (per[g.expression] || 0) + 1; pick.push(g); }
    index[p.slug] = { name: p.name, aliases: p.aliases || [], ...(p.sensitive ? { sensitive: true } : {}), photos: pick.map((g) => ({
      url: g.url, page: g.page, credit: g.credit, year: g.year, expression: g.expression, quality: g.cover_quality, face: g.face,
      pos: `center ${Math.round(Math.min(0.6, Math.max(0.1, Number(g.face_y) || 0.3)) * 100)}%`,
    })) };
    console.log(`::notice::${p.name}: ${cands.length} found, ${judged.length} checked, ${good.length} good, ${pick.length} kept (${pick.map((g) => g.expression).join(', ')})`);
    if (pick.length) {
      const inputs = pick.flatMap((g) => ['-i', g.file]);
      const n = pick.length;
      const cell = 'scale=300:375:force_original_aspect_ratio=increase,crop=300:375';
      const filter = n > 1 ? pick.map((_, i) => `[${i}]${cell}[v${i}]`).join(';') + ';' + pick.map((_, i) => `[v${i}]`).join('') + `hstack=${n}` : `[0]${cell}`;
      try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '4', path.join(REVIEW, `${p.slug}.jpg`)]); } catch (e) { console.log(`sheet ${p.slug}: ${e.message.slice(0, 120)}`); }
    }
    fs.writeFileSync(outFile, JSON.stringify(index, null, 2) + '\n');
  }
})();
