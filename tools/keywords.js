// Keyword research from search autocomplete (Google + Bing, US English). No paid API.
// A suggestion that shows up for many seeds and high in the list is searched a lot.
// node tools/keywords.js > keywords.json
const TOOLS = ['chatgpt', 'claude', 'gemini', 'perplexity', 'notebooklm', 'copilot', 'grok', 'cursor', 'claude code',
  'midjourney', 'chatgpt image', 'elevenlabs', 'suno', 'runway', 'veo', 'capcut ai', 'canva ai', 'deepseek', 'meta ai',
  'sora', 'chatgpt atlas', 'gemini nano banana', 'kling', 'higgsfield', 'lovable', 'bolt new', 'n8n', 'zapier ai', 'ollama', 'ai agent'];
const MODS = ['how to', 'how to use', 'not working', 'vs', 'free', 'alternative', 'prompts for', 'for', 'can', 'limit', 'price', 'what is', 'tips', 'error', 'best'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function google(q) {
  const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  return (await r.json())[1] || [];
}
async function bing(q) {
  const r = await fetch(`https://api.bing.com/osjson.aspx?market=en-US&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  return (await r.json())[1] || [];
}
(async () => {
  const hits = new Map();
  const add = (s, rank, src, seed, tool) => {
    s = s.toLowerCase().trim();
    if (!s.includes(tool.split(' ')[0])) return;
    const h = hits.get(s) || { q: s, tool, score: 0, seeds: new Set(), src: new Set() };
    h.score += 10 - Math.min(rank, 9); h.seeds.add(seed); h.src.add(src); hits.set(s, h);
  };
  for (const t of TOOLS) {
    for (const m of MODS) {
      const seeds = m === 'for' || m === 'vs' || m === 'not working' || m === 'alternative' || m === 'free' || m === 'limit' || m === 'price' || m === 'tips' || m === 'error' ? [`${t} ${m}`] : [`${m} ${t}`, `${t} ${m}`];
      for (const seed of seeds) {
        const [g, b] = await Promise.all([google(seed).catch(() => []), bing(seed).catch(() => [])]);
        g.forEach((s, i) => add(s, i, 'g', seed, t)); b.forEach((s, i) => add(s, i, 'b', seed, t));
        await sleep(250);
      }
    }
    console.error(t, hits.size);
  }
  const out = [...hits.values()].map((h) => ({ q: h.q, tool: h.tool, score: h.score + 5 * (h.seeds.size - 1) + (h.src.size === 2 ? 5 : 0), seeds: h.seeds.size, both: h.src.size === 2 }))
    .sort((a, b) => b.score - a.score);
  console.log(JSON.stringify(out, null, 1));
})();
