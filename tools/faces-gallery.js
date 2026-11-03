// Renders the face library (assets/people/index.json) as review pages: one row per person,
// one cell per photo with its expression. Usage: node tools/faces-gallery.js <out dir>
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/people-review'; fs.mkdirSync(OUT, { recursive: true });
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/people/index.json'), 'utf8'));
const W = 220, H = 275, COLS = 8, PER_PAGE = 8;
const esc = (t) => String(t).replace(/[:'\\]/g, ' ');
(async () => {
  const rows = []; const tmp = '/tmp/gallery'; fs.mkdirSync(tmp, { recursive: true });
  for (const [slug, p] of Object.entries(idx)) {
    const cells = [];
    for (const [i, ph] of p.photos.slice(-COLS).entries()) {
      const f = path.join(tmp, `${slug}-${i}`);
      try {
        const r = await fetch(ph.url, { headers: BROWSER, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        const y = Number(String(ph.pos || '').match(/(\d+)%/)?.[1] ?? 30) / 100;
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})*${y},drawtext=text='${esc(ph.expression)}':x=8:y=h-34:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5,format=yuvj420p`, '-frames:v', '1', `${f}.jpg`]);
        cells.push(`${f}.jpg`);
      } catch (e) { console.log(`::warning::${slug} ${i}: ${e.message}`); }
    }
    while (cells.length < COLS) { const f = path.join(tmp, `pad-${slug}-${cells.length}.jpg`); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x111111:s=${W}x${H}`, '-vf', 'format=yuvj420p', '-frames:v', '1', f]); cells.push(f); }
    const label = path.join(tmp, `${slug}-label.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x0b0b0b:s=${W * COLS}x44`, '-vf', `drawtext=text='${esc(p.name)}  (${p.photos.length})':x=12:y=10:fontsize=26:fontcolor=0x7CFC00,format=yuvj420p`, '-frames:v', '1', label]);
    const row = path.join(tmp, `${slug}-row.jpg`);
    try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...cells.flatMap((c) => ['-i', c]), '-filter_complex', `${cells.map((_, i) => `[${i}]`).join('')}hstack=${cells.length}`, '-frames:v', '1', `${row}.tmp.jpg`]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', label, '-i', `${row}.tmp.jpg`, '-filter_complex', 'vstack=2', '-frames:v', '1', row]);
    rows.push(row);
    } catch (e) { console.log(`::error::row ${slug}: ${String(e.stderr || e.message).slice(0, 300)}`); }
  }
  for (let p = 0; p * PER_PAGE < rows.length; p++) {
    const part = rows.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...part.flatMap((r) => ['-i', r]), '-filter_complex', part.length > 1 ? `${part.map((_, i) => `[${i}]`).join('')}vstack=${part.length}` : '[0]null', '-frames:v', '1', '-q:v', '4', path.join(OUT, `library-${p + 1}.jpg`)]);
  }
  console.log(`::notice::${rows.length} people in ${Math.ceil(rows.length / PER_PAGE)} pages`);
})();
