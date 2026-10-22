// Every Threads post of the last N days with its numbers, matched to our job (format, priority,
// whether it had a Threads-native text), plus daily account views and followers.
//   node src/threads-report.js [days] > reports/threads.json
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./state');

const TH = 'https://graph.threads.net/v1.0';
const token = process.env.THREADS_TOKEN;
async function get(p) {
  const r = await (await fetch(`${TH}/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`)).json();
  if (r.error) throw new Error(r.error.message);
  return r;
}

function jobsByPostId() {
  const map = {};
  const dir = path.join(ROOT, 'state', 'jobs');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const id = st.publish?.threads?.id || st.publish?.threads?.media_id || st.publish?.threads;
      if (id && typeof id === 'string') map[id] = st.id;
    } catch { /* skip */ }
  }
  return map;
}
function jobInfo(id) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'jobs', `${id}.json`), 'utf8'));
    return { job: id, format: j.type === 'reel' ? 'reel' : (j.format || 'news'), priority: j.priority || 2, from_link: Boolean(j.link_id), threads_text: Boolean(j.threads_text), slides: (j.slides || []).length, generated_cover: Boolean(j.slides?.[0]?.image?.generate) };
  } catch { return null; }
}

(async () => {
  const days = Number(process.argv[2]) || 60;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const posts = [];
  let url = `me/threads?fields=id,text,timestamp,permalink,media_type&since=${since}&limit=100`;
  for (let i = 0; i < 10 && url; i++) {
    const r = await get(url);
    posts.push(...(r.data || []));
    url = r.paging?.next ? r.paging.next.replace(`${TH}/`, '').replace(/&?access_token=[^&]+/, '') : null;
  }
  const byPost = jobsByPostId();
  const rows = [];
  for (const p of posts.filter((x) => x.media_type !== 'REPOST_FACADE')) {
    const ins = await get(`${p.id}/insights?metric=views,likes,replies,reposts,quotes,shares`).catch(() => ({ data: [] }));
    const m = {}; for (const x of ins.data || []) m[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0;
    const when = new Date(p.timestamp);
    rows.push({
      id: p.id, t: p.timestamp, hour_ny: Number(when.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })), weekday: when.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' }),
      media: p.media_type, text: String(p.text || '').slice(0, 300), chars: String(p.text || '').length, has_question: /\?/.test(String(p.text || '')),
      views: m.views || 0, likes: m.likes || 0, replies: m.replies || 0, reposts: m.reposts || 0, quotes: m.quotes || 0, shares: m.shares || 0,
      ...(byPost[p.id] ? jobInfo(byPost[p.id]) : {}),
    });
  }
  const acct = await get(`me/threads_insights?metric=views,followers_count&since=${Math.max(since, Math.floor(Date.now() / 1000) - 89 * 86400)}&until=${Math.floor(Date.now() / 1000)}`).catch((e) => ({ error: e.message }));
  const daily = (acct.data || []).find((m) => m.name === 'views')?.values?.map((v) => ({ day: v.end_time?.slice(0, 10), views: v.value })) || [];
  process.stdout.write(JSON.stringify({ generated_at: new Date().toISOString(), days, followers: (acct.data || []).find((m) => m.name === 'followers_count')?.total_value?.value ?? null, daily_views: daily, posts: rows }, null, 1) + '\n');
})().catch((e) => { console.error(e.message); process.exit(1); });
