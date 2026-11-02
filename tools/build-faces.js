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
    try { cands = (await candidates(p.name)).slice(0, 18); } catch (e) { console.log(`::warning::${p.slug}: ${e.message}`); }
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
