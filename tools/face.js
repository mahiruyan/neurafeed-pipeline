// Picks a cover photo of a person from the face library (assets/people/index.json).
// Usage: node tools/face.js <slug or name> [expression]
// expression: serious, worried, smiling, laughing, speaking, surprised, neutral (or any order of
// fallbacks, comma separated, e.g. "worried,serious"). Prints the JSON to paste into the cover:
// { url, credit, pos, fallback_urls } plus the caption credit. Photos used in the last 14 days of
// jobs are picked last, so the same face does not repeat on every cover.
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/people/index.json'), 'utf8'));
const [who = '', want = ''] = process.argv.slice(2);
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = Object.keys(idx).find((s) => s === who || norm(idx[s].name) === norm(who) || (idx[s].aliases || []).some((a) => norm(a) === norm(who)));
if (!slug) { console.error(`Not in the library: ${who}. People: ${Object.keys(idx).join(', ')}`); process.exit(1); }
const person = idx[slug];
// Expressions that can stand in for each other, in order.
const NEAR = { worried: ['worried', 'serious', 'surprised'], serious: ['serious', 'worried', 'neutral', 'speaking'], surprised: ['surprised', 'worried', 'laughing'], laughing: ['laughing', 'smiling'], smiling: ['smiling', 'laughing', 'neutral'], speaking: ['speaking', 'serious', 'smiling'], neutral: ['neutral', 'serious', 'smiling'] };
const order = want ? [...new Set(want.split(',').flatMap((w) => NEAR[w.trim()] || [w.trim()]))] : ['speaking', 'serious', 'smiling', 'laughing', 'worried', 'surprised', 'neutral'];
// Recently used photos (cover urls of jobs created in the last 14 days).
const used = new Map();
const since = Date.now() - 14 * 864e5;
for (const f of fs.readdirSync(path.join(ROOT, 'jobs'))) {
  if (!f.endsWith('.json')) continue;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', f), 'utf8'));
    if (Date.parse(j.created_at || 0) < since) continue;
    for (const s of j.slides || []) { const u = s.image?.url; if (u) used.set(u, (used.get(u) || 0) + 1); }
  } catch { /* skip broken files */ }
}
const rank = (p) => { const e = order.indexOf(p.expression); return [(used.get(p.url) || 0), e < 0 ? 99 : e, p.license === 'web' ? 0 : 1]; };
const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const fitting = person.photos.filter((p) => !want || order.includes(p.expression));
const pool = (fitting.length ? fitting : person.photos).slice().sort(cmp);
const [best, ...rest] = pool;
const out = {
  person: person.name,
  expression: best.expression,
  image: { url: best.url, credit: best.credit, fallback_urls: rest.slice(0, 2).map((p) => p.url) },
  pos: best.pos || 'center 30%',
  caption_credit: best.license === 'web' ? `Photo: ${best.credit.replace(/^via /, '')}` : `Photo: ${best.credit}`,
  ...(person.sensitive ? { note: 'Sensitive person: political stories go to Mahir for review.' } : {}),
};
console.log(JSON.stringify(out, null, 2));
