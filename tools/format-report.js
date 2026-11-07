// Which kind of carousel travels? Groups the last N days of posted jobs by kind (news, utility,
// list/posts, roundup, Mahir's links) and prints median and best views, plus the top 8 posts.
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const TOKEN = process.env.IG_ACCESS_TOKEN; const DAYS = Number(process.argv[2] || 30);
const ins = async (id, m) => { try { const r = await (await fetch(`https://graph.instagram.com/${id}/insights?metric=${m}&access_token=${encodeURIComponent(TOKEN)}`)).json(); return Number(r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? NaN); } catch { return NaN; } };
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
(async () => {
  const rows = []; const since = Date.now() - DAYS * 864e5;
  for (const f of fs.readdirSync(path.join(ROOT, 'jobs')).filter((x) => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', f), 'utf8')); } catch { continue; }
    const sf = path.join(ROOT, 'state/jobs', f); if (!fs.existsSync(sf)) continue;
    const st = JSON.parse(fs.readFileSync(sf, 'utf8')); const at = Date.parse(st.posted_at || 0);
    const media = st.publish?.media_id || JSON.stringify(st).match(/"media_id":"(\d+)"/)?.[1];
    if (st.status !== 'posted' || !media || at < since || Date.now() - at < 2 * 864e5) continue;
    const kind = j.type === 'reel' ? 'reel' : j.link_id ? 'mahir-link' : j.format === 'utility' ? 'utility' : j.format === 'roundup' ? 'roundup' : j.format === 'list' || j.format === 'posts' ? 'list/posts' : 'news';
    rows.push({ id: j.id, kind, views: await ins(media, 'views'), shares: await ins(media, 'shares'), saved: await ins(media, 'saved'), head: (j.slides?.[0]?.headline || j.hook || '').replace(/\*/g, '').slice(0, 70) });
  }
  const g = {}; for (const r of rows) (g[r.kind] ||= []).push(r);
  for (const [k, a] of Object.entries(g).sort((x, y) => y[1].length - x[1].length)) {
    const v = a.map((r) => r.views).filter(Number.isFinite);
    console.log(`::notice::${k}: n=${a.length} median=${Math.round(med(v))} mean=${Math.round(v.reduce((x, y) => x + y, 0) / (v.length || 1))} best=${Math.max(...v)} shares/post=${(a.reduce((x, r) => x + (r.shares || 0), 0) / a.length).toFixed(1)} saves/post=${(a.reduce((x, r) => x + (r.saved || 0), 0) / a.length).toFixed(1)}`);
  }
  const car = rows.filter((r) => r.kind !== 'reel').sort((x, y) => (y.views || 0) - (x.views || 0));
  console.log(`::notice::top carousels: ${car.slice(0, 8).map((r) => `${r.views} [${r.kind}] ${r.head}`).join(' | ')}`);
  console.log(`::notice::worst carousels: ${car.slice(-5).map((r) => `${r.views} [${r.kind}] ${r.head}`).join(' | ')}`);
})();
