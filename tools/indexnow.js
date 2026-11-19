// Tells IndexNow (Bing and the engines that share it) about pages of neurafeedai.com that it has
// not been told about yet. Reads the site's sitemaps, compares with state/indexnow.json, sends
// only the new addresses and remembers them. Run by indexnow.yml after each site sync.
const fs = require('fs');
const HOST = 'neurafeedai.com';
const KEY = '7511e5cb13ac86fe486ca0cfdc64d3e8';
const STATE = 'state/indexnow.json';
const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'NeuraFeedIndexNow/1.0' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.text(); };
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

(async () => {
  const seen = new Set(); const pages = new Set(); const queue = [`https://${HOST}/sitemap.xml`];
  while (queue.length && seen.size < 30) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    const xml = await get(u);
    for (const loc of locs(xml)) (/\.xml(\?|$)/.test(loc) ? queue : { push: (x) => pages.add(x) }).push(loc);
  }
  const mine = [...pages].filter((u) => { try { return new URL(u).host === HOST; } catch { return false; } });
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { submitted: [] };
  const done = new Set(state.submitted);
  const fresh = mine.filter((u) => !done.has(u));
  console.log(`sitemap pages: ${mine.length}, already sent: ${done.size}, new: ${fresh.length}`);
  if (!fresh.length) return;
  const keyFile = await get(`https://${HOST}/${KEY}.txt`).catch((e) => { throw new Error(`key file not reachable: ${e.message}`); });
  if (keyFile.trim() !== KEY) throw new Error('key file does not hold the key');
  for (let i = 0; i < fresh.length; i += 500) {
    const batch = fresh.slice(i, i + 500);
    const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: batch }) });
    console.log(`::notice::IndexNow: sent ${batch.length} pages -> HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    if (r.status !== 200 && r.status !== 202) throw new Error(`IndexNow refused the batch (${r.status})`);
    for (const u of batch) done.add(u);
  }
  fs.writeFileSync(STATE, JSON.stringify({ updated_at: new Date().toISOString(), submitted: [...done].sort() }, null, 1) + '\n');
})().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
