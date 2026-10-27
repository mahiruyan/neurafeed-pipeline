// Screenshots of the real source articles for the documentary:
//  headline.png: the IPO article's headline block; risk.png: the paragraph about catastrophic risks,
//  with the exact phrase's rectangles (for the animated highlighter). Writes public/assets/shots.json.
const fs = require('fs'); const path = require('path');
const puppeteer = require(require.resolve('puppeteer', { paths: [path.join(__dirname, '../..')] }));
const OUT = path.join(__dirname, 'public/assets');
const clean = () => {
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && el.tagName !== 'HTML' && el.tagName !== 'BODY') el.remove();
  }
  for (const el of document.querySelectorAll('iframe, [id*="ad-"], [class*="ad-slot"], [class*="newsletter"]')) el.remove();
};
async function open(b, url) {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 2 });
  await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36');
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(clean);
  return p;
}
async function headline(b, url, source) {
  const p = await open(b, url);
  const r = await p.evaluate(() => {
    const h = document.querySelector('article h1, main h1, h1'); if (!h) return null;
    h.scrollIntoView({ block: 'center' });
    const a = h.getBoundingClientRect(); const pad = 44;
    return { x: a.left - pad + scrollX, y: a.top - pad + scrollY, w: Math.min(a.width + 2 * pad, 1100), h: a.height + 2 * pad + 40 };
  });
  if (!r) return null;
  await p.screenshot({ path: path.join(OUT, 'headline.png'), clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  await p.close();
  return { src: 'assets/headline.png', w: r.w, h: r.h, source };
}
async function risk(b, url, source) {
  const p = await open(b, url);
  const r = await p.evaluate(() => {
    const ps = [...document.querySelectorAll('article p, main p, p')].filter((e) => /catastrophic/i.test(e.textContent) && e.textContent.trim().length > 80 && e.getBoundingClientRect().width > 400);
    const el = ps[0]; if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes = []; let all = '';
    while (walker.nextNode()) { nodes.push({ n: walker.currentNode, at: all.length }); all += walker.currentNode.nodeValue; }
    const m = /catastrophic[^.;]*?risks?/i.exec(all) || /catastrophic\S*/i.exec(all);
    const pos = (i) => { const k = nodes.filter((x) => x.at <= i).pop(); return [k.n, i - k.at]; };
    const range = document.createRange(); range.setStart(...pos(m.index)); range.setEnd(...pos(m.index + m[0].length));
    const box = el.getBoundingClientRect();
    const clip = { x: Math.max(0, box.left - 48), y: Math.max(0, box.top - 40), w: Math.min(box.width + 96, window.innerWidth), h: box.height + 80 };
    const page = { x: clip.x + scrollX, y: clip.y + scrollY };
    const marks = [...range.getClientRects()].filter((q) => q.width > 2).map((q) => ({ x: q.left - clip.x, y: q.top - clip.y, w: q.width, h: q.height }));
    return { clip: { ...clip, ...page }, marks, text: el.textContent.trim().slice(0, 400) };
  });
  if (!r) { await p.close(); return null; }
  await p.screenshot({ path: path.join(OUT, 'risk.png'), clip: { x: r.clip.x, y: r.clip.y, width: r.clip.w, height: r.clip.h } });
  await p.close();
  console.log('risk paragraph:', r.text);
  return { src: 'assets/risk.png', w: r.clip.w, h: r.clip.h, marks: r.marks, source };
}
async function commons(query, dest) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1920`;
  const d = await (await fetch(u, { headers: { 'User-Agent': 'NeuraFeedBot/1.0 (mahiruyan956@gmail.com)' } })).json();
  const files = Object.values(d.query?.pages || {}).map((p) => ({ title: p.title, ...(p.imageinfo?.[0] || {}) }))
    .filter((f) => /\.(jpe?g|png)$/i.test(f.title) && f.width >= 1000 && /amodei/i.test(f.title));
  console.log('commons candidates:', files.map((f) => `${f.title} ${f.width}x${f.height}`).join(' | '));
  const f = files[0]; if (!f) return null;
  const buf = Buffer.from(await (await fetch(f.thumburl, { headers: { 'User-Agent': 'NeuraFeedBot/1.0' } })).arrayBuffer());
  fs.writeFileSync(dest, buf);
  const m = f.extmetadata || {}; const strip = (x) => String(x?.value || '').replace(/<[^>]+>/g, '').trim();
  return { title: f.title, url: f.thumburl, credit: `${strip(m.Artist)} / ${strip(m.LicenseShortName)}`.replace(/^ \/ /, ''), candidates: files.map((x) => x.title) };
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const person = await commons('Dario Amodei', path.join(OUT, 'dario.jpg')).catch((e) => (console.log('commons failed', e.message), null));
  if (person) console.log(`::notice::Dario photo: ${person.title} ${person.url} (${person.credit})`);
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const out = { headline: null, risk: null, person };
  out.headline = await headline(b, 'https://techcrunch.com/2026/10/26/anthropic-officially-files-for-its-public-debut/', 'TechCrunch, Oct. 26, 2026').catch((e) => (console.log('headline failed', e.message), null));
  for (const [u, s] of [
    ['https://finance.yahoo.com/technology/article/anthropic-publicly-files-ipo-prospectus-noting-strong-revenue-growth-and-massive-spending-131807138.html', 'Yahoo Finance, Oct. 2026'],
    ['https://techcrunch.com/2026/10/26/anthropic-officially-files-for-its-public-debut/', 'TechCrunch, Oct. 26, 2026'],
    ['https://finance.yahoo.com/technology/live/anthropic-ipo-live-updates-frontier-ai-lab-discloses-revenue-and-risks-in-highly-anticipated-s-1-filing-141702607.html', 'Yahoo Finance, Oct. 2026'],
    ['https://www.engadget.com/2296724/anthropic-files-to-go-public/', 'Engadget, Oct. 2026'],
  ]) {
    out.risk = await risk(b, u, s).catch((e) => (console.log('risk failed', u, e.message), null));
    if (out.risk) break;
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
})();
