// NeuraFeed performance report: collects Instagram numbers, writes the PDF, sends it to Telegram.
// Usage: node src/report/build.js [days=7]   (needs IG_ACCESS_TOKEN, IG_USER_ID; optional
// DEEPSEEK_API_KEY for the written insights, TELEGRAM_BOT_TOKEN to deliver it)
const fs = require('fs');
const path = require('path');
const { collect } = require('./data');
const { fontCss, logo } = require('../templates');

const ACC = '#10a37f';
const GRAY = '#6b7280';
const fmt = (n) => (!Number.isFinite(n) ? 'n/a' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.round(n).toLocaleString('en-US'));
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? ((a - b) / b) * 100 : NaN);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dayLabel = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function delta(v, base, label) {
  const p = pct(v, base);
  if (!Number.isFinite(p)) return `<span class="d muted">${label}: n/a</span>`;
  const up = p >= 0;
  return `<span class="d ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% <span class="muted">${label}</span></span>`;
}

// Bar chart: this period (green) next to the previous period (gray), one axis, labels on ends.
function reachChart(cur, prev) {
  const W = 680; const H = 230; const pad = { l: 46, r: 8, t: 14, b: 30 };
  const n = cur.length;
  const max = Math.max(1, ...cur.map((d) => d.value), ...prev.map((d) => d.value));
  const step = (W - pad.l - pad.r) / Math.max(1, n);
  const bw = Math.max(3, Math.min(26, step / 2 - 3));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#2a2f2e" stroke-width="1"/><text x="${pad.l - 8}" y="${y(max * f) + 4}" text-anchor="end" class="ax">${fmt(max * f)}</text>`).join('');
  const bars = cur.map((d, i) => {
    const x = pad.l + i * step + step / 2;
    const p = prev[i]?.value ?? 0;
    const showLabel = n <= 10 || i % Math.ceil(n / 8) === 0;
    return `<rect x="${x - bw - 1}" y="${y(p)}" width="${bw}" height="${Math.max(0, y(0) - y(p))}" rx="3" fill="${GRAY}"/>
<rect x="${x + 1}" y="${y(d.value)}" width="${bw}" height="${Math.max(0, y(0) - y(d.value))}" rx="3" fill="${ACC}"/>
${showLabel ? `<text x="${x}" y="${H - 10}" text-anchor="middle" class="ax">${dayLabel(d.day)}</text>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily reach">${grid}${bars}</svg>
<div class="legend"><span><i style="background:${ACC}"></i>This period</span><span><i style="background:${GRAY}"></i>Previous period</span></div>`;
}

function hbars(rows, total, n = 6) {
  const top = rows.slice(0, n);
  const max = Math.max(1, ...top.map((r) => r.value));
  return top.map((r) => `<div class="hb"><span class="hk">${esc(r.key)}</span><span class="ht"><span style="width:${(r.value / max) * 100}%"></span></span><span class="hv">${total ? `${((r.value / total) * 100).toFixed(0)}%` : fmt(r.value)}</span></div>`).join('') || '<p class="muted">No data yet.</p>';
}

function score(m) { return (m.metrics.views || m.metrics.reach || 0); }

async function insights(data, summary) {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro', temperature: 0.3, max_tokens: 4000, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `You analyze the Instagram performance of @neurafeed.ai (English AI news for a US audience). Use ONLY these numbers, never invent any:\n${JSON.stringify(summary)}\nReturn JSON {"headline": "one sentence verdict of the period", "worked": ["3 short bullets with the numbers behind them"], "didnt": ["2 short bullets"], "next": ["3 concrete actions for the next period"]}. Plain English, no em dashes or en dashes.` }],
      }),
    });
    const d = await res.json();
    return JSON.parse(d.choices?.[0]?.message?.content || 'null');
  } catch { return null; }
}

function html(data, ai) {
  const { kpi, account, posts, days } = data;
  const end = new Date(data.to.getTime() - 1);
  const range = `${dayLabel(data.from)} to ${dayLabel(end)}, ${end.getUTCFullYear()}`;
  const title = days === 7 ? 'Weekly Performance Report' : days >= 28 ? 'Monthly Performance Report' : `${days}-Day Performance Report`;
  const fDaily = data.followersDaily.filter((d) => d.day > data.from.toISOString().slice(0, 10));
  const newFollowers = fDaily.reduce((a, d) => a + d.value, 0);
  const prevNew = data.followersDaily.filter((d) => d.day <= data.from.toISOString().slice(0, 10)).reduce((a, d) => a + d.value, 0);
  const curReach = data.reachDaily.slice(-days);
  const prevReach = data.reachDaily.slice(-2 * days, -days);
  const cards = [
    ['Reach', 'reach'], ['Views', 'views'], ['Interactions', 'total_interactions'], ['Accounts engaged', 'accounts_engaged'],
    ['Saves', 'saves'], ['Shares', 'shares'], ['Comments', 'comments'], ['Profile visits', 'profile_views'],
  ].map(([label, k]) => `<div class="card"><div class="cl">${label}</div><div class="cv">${fmt(kpi.current[k])}</div>${delta(kpi.current[k], kpi.previous[k], 'vs previous')}${delta(kpi.current[k], kpi.avg4[k], 'vs 4-period avg')}</div>`).join('');
  const sorted = [...posts].sort((a, b) => score(b) - score(a));
  const row = (m, i) => `<tr><td class="rk">${i + 1}</td><td>${m.thumb ? `<img class="th" src="${esc(m.thumb)}">` : ''}</td><td class="tt">${esc(m.title)}<div class="muted sm">${m.format} · ${new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' })} NY</div></td><td>${fmt(m.metrics.views)}</td><td>${fmt(m.metrics.reach)}</td><td>${fmt(m.metrics.saved)}</td><td>${fmt(m.metrics.shares)}</td></tr>`;
  const byFormat = {};
  for (const m of posts) { (byFormat[m.format] ||= []).push(score(m)); }
  const formats = Object.entries(byFormat).map(([k, v]) => ({ key: `${k} (${v.length})`, value: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => b.value - a.value);
  const slots = {};
  for (const m of posts) {
    const h = Number(new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }));
    const k = h < 11 ? 'Morning (7 to 11 NY)' : h < 17 ? 'Midday (11 to 17 NY)' : 'Evening (17 to 22 NY)';
    (slots[k] ||= []).push(score(m));
  }
  const slotRows = Object.entries(slots).map(([k, v]) => ({ key: `${k}, ${v.length} posts`, value: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => b.value - a.value);
  const aud = data.audience;
  const audTotal = (list) => list.reduce((a, r) => a + r.value, 0);
  const list = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#0b0f0e;color:#f2f4f3;font-family:Poppins;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:16mm 15mm;position:relative;page-break-after:always;overflow:hidden}
.top{display:flex;align-items:center;gap:10px;font-size:11px;color:#9aa1a7;margin-bottom:8mm}
.top img{width:26px;height:26px}
h1{font-family:Anton;font-weight:400;text-transform:uppercase;font-size:44px;line-height:1.02;margin:0}
h2{font-family:Anton;font-weight:400;text-transform:uppercase;font-size:24px;margin:0 0 4mm;letter-spacing:.3px}
.acc{color:${ACC}}
.muted{color:#9aa1a7}.sm{font-size:9px}
.hero{display:flex;gap:10mm;margin-top:14mm}
.hero div{flex:1;border-top:2px solid ${ACC};padding-top:4mm}
.hero .v{font-family:Anton;font-size:56px;line-height:1}
.hero .l{font-size:12px;color:#9aa1a7;margin-top:2mm}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-bottom:8mm}
.card{background:#141a19;border-radius:8px;padding:4mm}
.cl{font-size:10px;color:#9aa1a7}.cv{font-family:Anton;font-size:28px;margin:1mm 0 2mm}
.d{display:block;font-size:9.5px;margin-top:1px}.up{color:${ACC}}.down{color:#e5484d}
.ax{fill:#9aa1a7;font-size:10px;font-family:Poppins}
.legend{display:flex;gap:16px;font-size:10px;color:#c3c8cc;margin-top:2mm}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;font-size:10px}
th{text-align:left;color:#9aa1a7;font-weight:400;padding:2mm 1.5mm;border-bottom:1px solid #2a2f2e}
td{padding:2mm 1.5mm;border-bottom:1px solid #1d2322;vertical-align:middle}
td.rk{font-family:Anton;font-size:16px;color:${ACC};width:8mm}
.th{width:14mm;height:17mm;object-fit:cover;border-radius:4px;display:block}
td.tt{width:86mm}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
.hb{display:grid;grid-template-columns:42mm 1fr 14mm;align-items:center;gap:3mm;font-size:10.5px;margin:2mm 0}
.ht{height:9px;background:#1d2322;border-radius:4px;overflow:hidden}.ht span{display:block;height:100%;background:${ACC};border-radius:4px}
.hv{text-align:right;color:#c3c8cc}
.box{background:#141a19;border-radius:8px;padding:5mm;margin-bottom:5mm}
.box ul{margin:2mm 0 0;padding-left:5mm;font-size:11.5px;line-height:1.55}
.verdict{font-size:16px;line-height:1.45;margin:0 0 6mm}
.foot{position:absolute;bottom:9mm;left:15mm;right:15mm;font-size:9px;color:#6b7280;display:flex;justify-content:space-between}
</style></head><body>

<section class="page">
<div class="top"><img src="${logo}">NEURAFEED AI · @${esc(account.username)}</div>
<div class="muted" style="font-size:13px;margin-top:30mm">${range}</div>
<h1>${title.split(' ').slice(0, -1).join(' ')} <span class="acc">${title.split(' ').at(-1)}</span></h1>
<div class="hero">
<div><div class="v">${fmt(account.followers_count)}</div><div class="l">Followers</div></div>
<div><div class="v ${newFollowers >= 0 ? 'acc' : ''}">${newFollowers >= 0 ? '+' : ''}${fmt(newFollowers)}</div><div class="l">New followers this period${Number.isFinite(prevNew) && prevNew ? ` (previous: ${prevNew >= 0 ? '+' : ''}${fmt(prevNew)})` : ''}</div></div>
<div><div class="v">${posts.length}</div><div class="l">Posts published (previous: ${data.prevPosts.length})</div></div>
</div>
${ai?.headline ? `<p class="verdict" style="margin-top:16mm">${esc(ai.headline)}</p>` : ''}
<div class="foot"><span>Generated ${new Date().toUTCString().slice(5, 22)} UTC</span><span>Data: Instagram API</span></div>
</section>

<section class="page">
<div class="top"><img src="${logo}">KEY NUMBERS · ${range}</div>
<h2>Key <span class="acc">numbers</span></h2>
<div class="grid">${cards}</div>
<h2>Daily <span class="acc">reach</span></h2>
${reachChart(curReach, prevReach)}
<div class="foot"><span>Changes compare with the previous ${days} days and with the average of the last 4 periods of ${days} days.</span><span>2</span></div>
</section>

<section class="page">
<div class="top"><img src="${logo}">CONTENT · ${range}</div>
<h2>Top <span class="acc">posts</span></h2>
<table><tr><th></th><th></th><th>Post</th><th>Views</th><th>Reach</th><th>Saves</th><th>Shares</th></tr>${sorted.slice(0, 6).map(row).join('') || '<tr><td colspan="7" class="muted">No posts in this period.</td></tr>'}</table>
${sorted.length > 6 ? `<h2 style="margin-top:7mm">Weakest <span class="acc">posts</span></h2><table>${sorted.slice(-3).reverse().map((m, i) => row(m, sorted.length - 1 - i)).join('')}</table>` : ''}
<div class="foot"><span>Ranked by views (reach when views are missing).</span><span>3</span></div>
</section>

<section class="page">
<div class="top"><img src="${logo}">FORMATS, TIMING, AUDIENCE · ${range}</div>
<div class="cols">
<div><h2>By <span class="acc">format</span></h2><div class="muted sm" style="margin-bottom:2mm">Average views per post</div>${hbars(formats)}</div>
<div><h2>By <span class="acc">time slot</span></h2><div class="muted sm" style="margin-bottom:2mm">Average views per post, New York time</div>${hbars(slotRows)}</div>
</div>
<h2 style="margin-top:10mm">Who <span class="acc">follows</span></h2>
<div class="cols">
<div><div class="muted sm">Top countries</div>${hbars(aud.country, audTotal(aud.country))}</div>
<div><div class="muted sm">Top cities</div>${hbars(aud.city, audTotal(aud.city))}</div>
<div><div class="muted sm">Age</div>${hbars(aud.age, audTotal(aud.age))}</div>
<div><div class="muted sm">Gender (F female, M male, U unknown)</div>${hbars(aud.gender, audTotal(aud.gender))}</div>
</div>
<div class="foot"><span>Audience shares are for all followers (lifetime).</span><span>4</span></div>
</section>

${ai ? `<section class="page">
<div class="top"><img src="${logo}">TAKEAWAYS · ${range}</div>
<h2>What <span class="acc">worked</span></h2><div class="box"><ul>${list(ai.worked)}</ul></div>
<h2>What <span class="acc">didn't</span></h2><div class="box"><ul>${list(ai.didnt)}</ul></div>
<h2>Next <span class="acc">${days === 7 ? 'week' : 'period'}</span></h2><div class="box"><ul>${list(ai.next)}</ul></div>
<div class="foot"><span>Written from the numbers in this report.</span><span>5</span></div>
</section>` : ''}
</body></html>`;
}

async function sendTelegram(file, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID || (() => { try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'state', 'telegram_owner.json'), 'utf8')).chat_id); } catch { return null; } })();
  if (!token || !chat) return console.log('Telegram not configured, PDF kept at', file);
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('caption', caption);
  form.append('document', new Blob([fs.readFileSync(file)], { type: 'application/pdf' }), path.basename(file));
  const r = await (await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form })).json();
  if (!r.ok) throw new Error(`Telegram: ${r.description}`);
}

(async () => {
  const days = Math.max(1, Math.min(90, Number(process.argv[2]) || 7));
  const data = await collect(days);
  const k = data.kpi;
  const summary = {
    period_days: days, followers: data.account.followers_count, posts: data.posts.length, previous_posts: data.prevPosts.length,
    kpis_current: k.current, kpis_previous: k.previous, kpis_4period_avg: k.avg4,
    posts_detail: data.posts.map((m) => ({ title: m.title, format: m.format, time_ny: new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }), ...m.metrics })),
    top_countries: data.audience.country.slice(0, 5),
  };
  const ai = await insights(data, summary);
  const out = path.join(__dirname, '..', '..', 'reports');
  fs.mkdirSync(out, { recursive: true });
  const htmlFile = path.join(out, 'report.html');
  fs.writeFileSync(htmlFile, html(data, ai));
  const puppeteer = require('puppeteer');
  const opts = { headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  const browser = await puppeteer.launch(opts);
  const page = await browser.newPage();
  await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const end = new Date(data.to.getTime() - 1).toISOString().slice(0, 10);
  const pdf = path.join(out, `neurafeed-${days}d-report-${end}.pdf`);
  await page.pdf({ path: pdf, format: 'A4', printBackground: true });
  await browser.close();
  console.log('PDF:', pdf);
  await sendTelegram(pdf, `📊 NeuraFeed ${days === 7 ? 'weekly' : `${days}-day`} report, until ${end}`);
})().catch((e) => { console.error(e); console.log(`::error::report failed: ${e.message}`); process.exit(1); });
