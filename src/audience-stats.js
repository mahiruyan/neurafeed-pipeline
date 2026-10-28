// Weekly audience numbers for the website's sponsorship and link pages.
// Reads Instagram and Threads insights (last 30 days) and sends them to the admin API, which
// stores them as the "automatic" values. Numbers typed in the admin override these.
// Usage: IG_USER_ID IG_ACCESS_TOKEN THREADS_TOKEN SITE_REVIEW_TOKEN node src/audience-stats.js [--dry]
const IG = 'https://graph.instagram.com';
const TH = 'https://graph.threads.net/v1.0';
const DAY = 864e5;
const sec = (t) => Math.floor(t / 1000);

// Europe (EU, EEA, UK, Switzerland and the rest of geographic Europe), ISO 3166-1 alpha-2.
const EUROPE = new Set('AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA VA XK'.split(' '));

async function get(base, token, pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const res = await fetch(`${base}/${pathAndQuery}${sep}access_token=${encodeURIComponent(token)}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d;
}

async function instagram() {
  const user = process.env.IG_USER_ID; const token = process.env.IG_ACCESS_TOKEN;
  if (!user || !token) return {};
  const ig = (q) => get(IG, token, q);
  const to = Date.now(); const from = to - 30 * DAY;
  const total = async (metric) => {
    try { const d = await ig(`${user}/insights?metric=${metric}&period=day&metric_type=total_value&since=${sec(from)}&until=${sec(to)}`); return Number(d.data?.[0]?.total_value?.value); } catch { return NaN; }
  };
  const out = {};
  const account = await ig(`${user}?fields=followers_count`);
  if (account.followers_count) out.instagram_followers = account.followers_count;
  const [reach, views, interactions] = await Promise.all([total('reach'), total('views'), total('total_interactions')]);
  if (reach > 0) out.monthly_reach = reach;
  if (views > 0) out.ig_views = views;
  if (reach > 0 && interactions >= 0) out.engagement_rate = Math.round(interactions / reach * 1000) / 10;
  // Where the followers are (Instagram shows this from 100 followers on).
  try {
    const d = await ig(`${user}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=country`);
    const rows = (d.data?.[0]?.total_value?.breakdowns?.[0]?.results || []).map((r) => ({ code: r.dimension_values[0], value: Number(r.value) || 0 }));
    const sum = rows.reduce((a, r) => a + r.value, 0);
    if (sum > 0) {
      const names = new Intl.DisplayNames(['en'], { type: 'region' });
      out.top_countries = rows.sort((a, b) => b.value - a.value).slice(0, 5).map((r) => ({ country: r.code === 'US' ? 'US' : r.code === 'GB' ? 'UK' : (names.of(r.code) || r.code), share: Math.round(r.value / sum * 1000) / 10 }));
      out.us_europe_share = Math.round(rows.filter((r) => r.code === 'US' || EUROPE.has(r.code)).reduce((a, r) => a + r.value, 0) / sum * 1000) / 10;
    }
  } catch (e) { console.log(`::notice::No country breakdown: ${e.message}`); }
  return out;
}

async function threads() {
  const token = process.env.THREADS_TOKEN;
  if (!token) return {};
  const to = Date.now(); const from = to - 30 * DAY;
  try {
    const d = await get(TH, token, `me/threads_insights?metric=views,followers_count&since=${sec(from)}&until=${sec(to)}`);
    const views = (d.data || []).find((m) => m.name === 'views')?.values?.reduce((a, v) => a + (Number(v.value) || 0), 0);
    const followers = (d.data || []).find((m) => m.name === 'followers_count')?.total_value?.value;
    return { ...(followers ? { threads_followers: Number(followers) } : {}), ...(views ? { th_views: views } : {}) };
  } catch (e) { console.log(`::warning::Threads insights failed: ${e.message}`); return {}; }
}

(async () => {
  const [a, b] = await Promise.all([instagram(), threads()]);
  const stats = { ...a, ...b };
  const views = (stats.ig_views || 0) + (stats.th_views || 0);
  if (views > 0) stats.monthly_views = views;
  delete stats.ig_views; delete stats.th_views;
  console.log(`::notice::stats ${JSON.stringify(stats)}`);
  if (process.argv.includes('--dry')) return;
  const res = await fetch('https://admin.neurafeedai.com/api/jobs/audience-stats', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SITE_REVIEW_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ stats }),
  });
  const text = await res.text();
  if (!res.ok) { console.log(`::error::Admin API ${res.status}: ${text.slice(0, 300)}`); process.exit(1); }
  console.log(`::notice::Saved ${text.slice(0, 300)}`);
})().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
