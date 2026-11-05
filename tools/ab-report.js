// Cover A/B report: for every carousel with an "ab" field that was posted at least 2 days ago,
// reads its Instagram insights and compares the variants (median and mean views, reach, shares,
// saves). Prints workflow notices and, with TELEGRAM_* set, sends the summary to Mahir.
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const TOKEN = process.env.IG_ACCESS_TOKEN;
const DAYS = Number(process.argv[2] || 30);
async function insight(id, metric) {
  try {
    const r = await (await fetch(`https://graph.instagram.com/${id}/insights?metric=${metric}&access_token=${encodeURIComponent(TOKEN)}`)).json();
    return Number(r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? NaN);
  } catch { return NaN; }
}
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a) => { const s = a.filter(Number.isFinite); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : 0; };
(async () => {
  const rows = [];
  const since = Date.now() - DAYS * 864e5;
  for (const f of fs.readdirSync(path.join(ROOT, 'jobs')).filter((x) => x.endsWith('.json'))) {
    let job; try { job = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', f), 'utf8')); } catch { continue; }
    if (!job.ab || job.type === 'reel') continue;
    const sf = path.join(ROOT, 'state/jobs', f);
    if (!fs.existsSync(sf)) continue;
    const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
    const media = st.publish?.media_id || JSON.stringify(st).match(/"media_id":"(\d+)"/)?.[1];
    const at = Date.parse(st.posted_at || 0);
    if (st.status !== 'posted' || !media || at < since || Date.now() - at < 2 * 864e5) continue;
    const m = {};
    for (const k of ['views', 'reach', 'shares', 'saved']) m[k] = await insight(media, k);
    rows.push({ id: job.id, ab: job.ab, ...m });
  }
  const lines = [`Kapak A/B testi (son ${DAYS} gün, en az 2 günlük ${rows.length} carousel)`];
  for (const dim of ['headline', 'photo']) {
    const groups = {};
    for (const r of rows) if (r.ab[dim]) (groups[r.ab[dim]] ||= []).push(r);
    if (Object.keys(groups).length < 2) continue;
    lines.push('', dim === 'headline' ? 'Başlık uzunluğu:' : 'Kapak fotoğrafı:');
    for (const [v, g] of Object.entries(groups)) {
      lines.push(`- ${v}: ${g.length} paylaşım, izlenme medyan ${Math.round(med(g.map((x) => x.views)))} / ort ${Math.round(avg(g.map((x) => x.views)))}, erişim medyan ${Math.round(med(g.map((x) => x.reach)))}, paylaşım ort ${avg(g.map((x) => x.shares)).toFixed(1)}, kaydetme ort ${avg(g.map((x) => x.saved)).toFixed(1)}`);
    }
  }
  if (rows.length < 20) lines.push('', 'Not: 20 paylaşımdan az, sonuç henüz güvenilir değil.');
  const text = lines.join('\n');
  for (const l of lines.filter(Boolean)) console.log(`::notice::${l}`);
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports/ab-latest.json'), JSON.stringify(rows, null, 2));
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.SEND !== 'false') {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) });
  }
})();
