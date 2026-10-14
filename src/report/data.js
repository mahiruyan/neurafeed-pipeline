// Collects everything the performance report needs from the Instagram API.
const BASE = 'https://graph.instagram.com';
const TOKEN = process.env.IG_ACCESS_TOKEN;
const USER = process.env.IG_USER_ID;

async function get(pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}/${pathAndQuery}${sep}access_token=${encodeURIComponent(TOKEN)}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d;
}
const sec = (d) => Math.floor(d.getTime() / 1000);
const DAY = 864e5;

// Daily series for a metric between two dates (API allows 30 days per call).
async function daily(metric, from, to) {
  const out = [];
  for (let s = from.getTime(); s < to.getTime(); s += 30 * DAY) {
    const e = Math.min(to.getTime(), s + 30 * DAY);
    try {
      const d = await get(`${USER}/insights?metric=${metric}&period=day&since=${sec(new Date(s))}&until=${sec(new Date(e))}`);
      for (const v of d.data?.[0]?.values || []) out.push({ day: v.end_time.slice(0, 10), value: Number(v.value) || 0 });
    } catch { /* metric not available for this range */ }
  }
  return out;
}

// One total for a metric over a window.
async function total(metric, from, to) {
  try {
    const d = await get(`${USER}/insights?metric=${metric}&period=day&metric_type=total_value&since=${sec(from)}&until=${sec(to)}`);
    return Number(d.data?.[0]?.total_value?.value ?? NaN);
  } catch { return NaN; }
}

async function mediaIn(from, to) {
  const fields = 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count';
  let url = `${USER}/media?fields=${fields}&limit=50`;
  const items = [];
  for (let page = 0; page < 6 && url; page++) {
    const d = await get(url);
    for (const m of d.data || []) {
      const t = new Date(m.timestamp);
      if (t >= from && t < to) items.push(m);
    }
    const last = d.data?.at(-1);
    if (!last || new Date(last.timestamp) < from || !d.paging?.next) break;
    const u = new URL(d.paging.next);
    u.searchParams.delete('access_token');
    url = u.pathname.replace(/^\/(v[\d.]+\/)?/, '') + u.search;
  }
  for (const m of items) {
    const isReel = m.media_product_type === 'REELS';
    const metrics = ['reach', 'views', 'saved', 'shares', 'total_interactions'].concat(isReel ? ['ig_reels_avg_watch_time'] : []);
    m.metrics = {};
    for (const k of metrics) {
      try {
        const d = await get(`${m.id}/insights?metric=${k}`);
        m.metrics[k] = Number(d.data?.[0]?.values?.[0]?.value ?? d.data?.[0]?.total_value?.value ?? 0);
      } catch { /* not available for this media */ }
    }
    m.format = isReel ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : m.media_type === 'VIDEO' ? 'Video' : 'Single image';
    m.title = String(m.caption || '').split('\n')[0].slice(0, 120);
    m.thumb = m.thumbnail_url || m.media_url || '';
  }
  return items;
}

async function demographics(breakdown) {
  try {
    const d = await get(`${USER}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}`);
    return (d.data?.[0]?.total_value?.breakdowns?.[0]?.results || [])
      .map((r) => ({ key: r.dimension_values.join(' '), value: r.value }))
      .sort((a, b) => b.value - a.value);
  } catch { return []; }
}

// Who actually saw (reached) or interacted (engaged) in a timeframe, by country/age/gender/city.
async function viewers(metric, timeframe, breakdown) {
  try {
    const d = await get(`${USER}/insights?metric=${metric}&period=lifetime&timeframe=${timeframe}&metric_type=total_value&breakdown=${breakdown}`);
    return (d.data?.[0]?.total_value?.breakdowns?.[0]?.results || [])
      .map((r) => ({ key: r.dimension_values.join(' '), value: r.value }))
      .sort((a, b) => b.value - a.value);
  } catch { return []; }
}

const KPIS = ['reach', 'views', 'total_interactions', 'accounts_engaged', 'likes', 'comments', 'saves', 'shares', 'profile_views'];

async function collect(days, end = new Date()) {
  const to = new Date(Math.floor(end.getTime() / DAY) * DAY); // midnight UTC today
  const from = new Date(to.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const histFrom = new Date(from.getTime() - 4 * days * DAY); // 4 previous periods for the average

  const account = await get(`${USER}?fields=username,followers_count,follows_count,media_count`);
  const kpi = { current: {}, previous: {}, avg4: {} };
  for (const k of KPIS) {
    kpi.current[k] = await total(k, from, to);
    kpi.previous[k] = await total(k, prevFrom, from);
    const past = [];
    for (let i = 1; i <= 4; i++) past.push(await total(k, new Date(from.getTime() - i * days * DAY), new Date(from.getTime() - (i - 1) * days * DAY)));
    const ok = past.filter((v) => Number.isFinite(v));
    kpi.avg4[k] = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
  }
  const reachDaily = await daily('reach', histFrom, to);
  const followersDaily = await daily('follower_count', prevFrom, to);
  const posts = await mediaIn(from, to);
  const prevPosts = await mediaIn(prevFrom, from);
  const audience = {
    country: await demographics('country'),
    age: await demographics('age'),
    gender: await demographics('gender'),
    city: await demographics('city'),
  };
  const tf = days <= 7 ? 'this_week' : 'this_month';
  const reached = {
    timeframe: tf,
    country: await viewers('reached_audience_demographics', tf, 'country'),
    age: await viewers('reached_audience_demographics', tf, 'age'),
    city: await viewers('reached_audience_demographics', tf, 'city'),
  };
  return { days, from, to, prevFrom, account, kpi, reachDaily, followersDaily, posts, prevPosts, audience, reached };
}

module.exports = { collect };
