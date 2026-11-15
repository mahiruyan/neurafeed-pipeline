// The account's most viewed posts of all time, straight from Instagram (also posts made before
// this pipeline existed). Prints one line per post: views, shares, type, date, start of caption.
const TOKEN = process.env.IG_ACCESS_TOKEN; const MAX = Number(process.argv[2] || 400);
const get = async (u) => (await fetch(u)).json();
const ins = async (id, m) => { try { const r = await get(`https://graph.instagram.com/${id}/insights?metric=${m}&access_token=${encodeURIComponent(TOKEN)}`); return Number(r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? NaN); } catch { return NaN; } };
(async () => {
  let url = `https://graph.instagram.com/me/media?fields=id,media_type,media_product_type,timestamp,caption,like_count,comments_count&limit=50&access_token=${encodeURIComponent(TOKEN)}`;
  const all = [];
  while (url && all.length < MAX) { const r = await get(url); if (!r.data) { console.log('ERR', JSON.stringify(r).slice(0, 300)); break; } all.push(...r.data); url = r.paging?.next; }
  const rows = [];
  for (const m of all) rows.push({ ...m, views: await ins(m.id, 'views'), shares: await ins(m.id, 'shares') });
  rows.sort((a, b) => (b.views || 0) - (a.views || 0));
  console.log(`TOTAL\t${rows.length}\toldest ${rows.map((r) => r.timestamp).sort()[0]}`);
  for (const r of rows.slice(0, 40)) console.log(`TOP\t${r.views}\t${r.shares}\t${r.like_count}\t${r.media_product_type || r.media_type}\t${(r.timestamp || '').slice(0, 10)}\t${(r.caption || '').replace(/\s+/g, ' ').slice(0, 110)}`);
})();
