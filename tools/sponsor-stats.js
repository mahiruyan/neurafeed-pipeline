// Numbers sponsors ask for: audience countries and, for the last N days, average reach, views and
// engagement rate (likes + comments + shares + saves divided by reach) for carousels and Reels.
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const TOKEN = process.env.IG_ACCESS_TOKEN; const USER = process.env.IG_USER_ID; const DAYS = Number(process.argv[2] || 30);
const api = async (p) => (await fetch(`https://graph.instagram.com/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`)).json();
const ins = async (id, m) => { try { const r = await api(`${id}/insights?metric=${m}`); return Number(r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? NaN); } catch { return NaN; } };
const avg = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
(async () => {
  const me = await api(`${USER}?fields=followers_count,media_count`);
  console.log(`::notice::followers=${me.followers_count} media=${me.media_count}`);
  for (const metric of ['follower_demographics', 'engaged_audience_demographics', 'reached_audience_demographics']) {
    const r = await api(`${USER}/insights?metric=${metric}&period=lifetime&metric_type=total_value&breakdown=country${metric === 'follower_demographics' ? '' : '&timeframe=this_month'}`);
    const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
    const total = res.reduce((x, y) => x + y.value, 0);
    const top = res.sort((a, b) => b.value - a.value).slice(0, 8).map((x) => `${x.dimension_values[0]} ${(100 * x.value / total).toFixed(1)}%`).join(', ');
    console.log(`::notice::${metric}: total=${total} ${top}${r.error ? ' error=' + r.error.message : ''}`);
  }
  const rows = []; const since = Date.now() - DAYS * 864e5;
  for (const f of fs.readdirSync(path.join(ROOT, 'jobs')).filter((x) => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', f), 'utf8')); } catch { continue; }
    const sf = path.join(ROOT, 'state/jobs', f); if (!fs.existsSync(sf)) continue;
    const st = JSON.parse(fs.readFileSync(sf, 'utf8')); const at = Date.parse(st.posted_at || 0);
    const media = st.publish?.media_id || JSON.stringify(st).match(/"media_id":"(\d+)"/)?.[1];
    if (st.status !== 'posted' || !media || at < since || Date.now() - at < 2 * 864e5) continue;
    const r = { kind: j.type === 'reel' ? 'reel' : 'carousel', reach: await ins(media, 'reach'), views: await ins(media, 'views') };
    const e = ['likes', 'comments', 'shares', 'saved']; let sum = 0; for (const m of e) { const v = await ins(media, m); if (Number.isFinite(v)) sum += v; }
    r.eng = sum; r.rate = r.reach > 0 ? sum / r.reach : NaN; rows.push(r);
  }
  for (const k of ['carousel', 'reel']) {
    const a = rows.filter((r) => r.kind === k);
    console.log(`::notice::${k} last ${DAYS}d: n=${a.length} reach avg=${Math.round(avg(a.map((r) => r.reach)))} median=${Math.round(med(a.map((r) => r.reach)))} | views avg=${Math.round(avg(a.map((r) => r.views)))} median=${Math.round(med(a.map((r) => r.views)))} max=${Math.max(...a.map((r) => r.views).filter(Number.isFinite))} | engagement/post avg=${avg(a.map((r) => r.eng)).toFixed(1)} | eng rate (by reach) avg=${(100 * avg(a.map((r) => r.rate))).toFixed(2)}% median=${(100 * med(a.map((r) => r.rate))).toFixed(2)}%`);
  }
})();
