// When do our posts do best? Reads the last N days of Instagram posts with their views and
// groups them by posting hour (New York and Istanbul time) and format. Prints workflow notices.
// Usage: node tools/hour-report.js [days]   (needs IG_ACCESS_TOKEN, IG_USER_ID)
const TOKEN = process.env.IG_ACCESS_TOKEN; const USER = process.env.IG_USER_ID;
const DAYS = Number(process.argv[2] || 30);
const get = async (p) => { const r = await (await fetch(`https://graph.instagram.com/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`)).json(); if (r.error) throw new Error(r.error.message); return r; };
const hourIn = (d, tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
(async () => {
  const since = Date.now() - DAYS * 864e5; const items = [];
  let url = `${USER}/media?fields=id,timestamp,media_type,media_product_type&limit=50`;
  for (let i = 0; i < 8 && url; i++) {
    const d = await get(url);
    for (const m of d.data || []) if (Date.parse(m.timestamp) >= since) items.push(m);
    const last = d.data?.at(-1); if (!last || Date.parse(last.timestamp) < since || !d.paging?.next) break;
    const u = new URL(d.paging.next); u.searchParams.delete('access_token'); url = u.pathname.replace(/^\/(v[\d.]+\/)?/, '') + u.search;
  }
  for (const m of items) { try { const r = await get(`${m.id}/insights?metric=views`); m.views = Number(r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? 0); } catch { m.views = null; } m.fmt = m.media_product_type === 'REELS' ? 'reel' : 'carousel'; }
  const rows = items.filter((m) => Number.isFinite(m.views) && Date.now() - Date.parse(m.timestamp) > 2 * 864e5);
  console.log(`::notice::${rows.length} posts (last ${DAYS} days, at least 2 days old)`);
  for (const fmt of ['carousel', 'reel']) {
    const g = {};
    for (const m of rows.filter((x) => x.fmt === fmt)) { const h = hourIn(new Date(m.timestamp), 'America/New_York'); (g[h] ||= []).push(m.views); }
    for (const h of Object.keys(g).map(Number).sort((a, b) => a - b)) {
      const ist = (h + 8) % 24;
      console.log(`::notice::${fmt} NY ${String(h).padStart(2, '0')}:00 (TR ${String(ist).padStart(2, '0')}:00): ${g[h].length} posts, median ${Math.round(med(g[h]))} views, best ${Math.max(...g[h])}`);
    }
  }
})();
