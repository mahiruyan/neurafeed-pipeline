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
        messages: [{ role: 'user', content: `You write the analysis section of the performance report of @neurafeed.ai (English AI news on Instagram). Use ONLY these numbers, never invent any. followers_by_country_count counts followers per country; viewers_by_country counts accounts reached in the period.
${JSON.stringify(summary)}
Return JSON {"verdict": "one plain sentence on the period with its key number", "findings": [3 to 4 items {"title": "a specific claim with a number, max 9 words, sentence case", "body": "1 or 2 short sentences with the numbers behind it"}], "actions": [3 items {"title": "a concrete action, max 8 words", "body": "1 sentence why, tied to a number above"}]}.
Write like a sharp analyst at a newsroom, plain words. Forbidden: em dashes, en dashes, exclamation marks, emojis, and the words leverage, boost, crucial, robust, delve, unlock, elevate, game changer, engagement-driving, synergy, insights.` }],
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error?.message || res.status);
    const text = String(d.choices?.[0]?.message?.content || '').replace(/^```(json)?|```$/g, '').trim();
    if (!text) throw new Error(`empty answer (finish: ${d.choices?.[0]?.finish_reason})`);
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch (e) {
    console.log(`::warning::insights failed: ${e.message}`);
    return null;
  }
}

function html(data, ai) {
  const { kpi, account, posts, days } = data;
  const end = new Date(data.to.getTime() - 1);
  const range = `${dayLabel(data.from)} to ${dayLabel(end)}, ${end.getUTCFullYear()}`;
  const kind = days === 7 ? 'Weekly report' : days >= 28 ? 'Monthly report' : `${days}-day report`;
  const fromDay = data.from.toISOString().slice(0, 10);
  const newFollowers = data.followersDaily.filter((d) => d.day > fromDay).reduce((a, d) => a + d.value, 0);
  const prevNew = data.followersDaily.filter((d) => d.day <= fromDay).reduce((a, d) => a + d.value, 0);
  const curReach = data.reachDaily.slice(-days);
  const prevReach = data.reachDaily.slice(-2 * days, -days);
  const metric = ([label, k]) => `<div class="m"><div class="lab">${label}</div><div class="num">${fmt(kpi.current[k])}</div>${delta(kpi.current[k], kpi.previous[k], 'vs previous')}${delta(kpi.current[k], kpi.avg4[k], 'vs 4-period avg')}</div>`;
  const metrics = [['Reach', 'reach'], ['Views', 'views'], ['Interactions', 'total_interactions'], ['Accounts engaged', 'accounts_engaged'], ['Saves', 'saves'], ['Shares', 'shares'], ['Comments', 'comments'], ['Profile visits', 'profile_views']].map(metric).join('');
  const sorted = [...posts].sort((a, b) => score(b) - score(a));
  const row = (m, i) => `<tr><td class="rk">${i + 1}</td><td>${m.thumb ? `<img class="th" src="${esc(m.thumb)}">` : ''}</td><td class="tt">${esc(m.title)}<div class="sub">${m.format} · ${new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' })} NY</div></td><td class="n">${fmt(m.metrics.views)}</td><td class="n">${fmt(m.metrics.reach)}</td><td class="n">${fmt(m.metrics.saved)}</td><td class="n">${fmt(m.metrics.shares)}</td></tr>`;
  const byFormat = {};
  for (const m of posts) (byFormat[m.format] ||= []).push(score(m));
  const formats = Object.entries(byFormat).map(([k, v]) => ({ key: `${k} (${v.length})`, value: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => b.value - a.value);
  const slots = {};
  for (const m of posts) {
    const h = Number(new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }));
    const k = h < 11 ? 'Morning, 7 to 11' : h < 17 ? 'Midday, 11 to 17' : 'Evening, 17 to 22';
    (slots[k] ||= []).push(score(m));
  }
  const slotRows = Object.entries(slots).map(([k, v]) => ({ key: `${k} (${v.length})`, value: v.reduce((a, b) => a + b, 0) / v.length })).sort((a, b) => b.value - a.value);
  const aud = data.audience;
  const rch = data.reached;
  const sum = (l) => l.reduce((a, r) => a + r.value, 0);
  const tfLabel = rch.timeframe === 'this_week' ? 'this week' : 'this month';
  const head = (label) => `<div class="top"><img src="${logo}"><span>NeuraFeed AI</span><span class="sep">/</span><span>${label}</span><span class="rng">${range}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#0c0f0e;color:#eef1f0;font-family:Poppins;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:15mm 16mm;position:relative;page-break-after:always;overflow:hidden}
.top{display:flex;align-items:center;gap:7px;font-size:9.5px;color:#8b9390;padding-bottom:4mm;border-bottom:1px solid #222826;margin-bottom:9mm}
.top img{width:18px;height:18px}.top .sep{color:#3a413e}.top .rng{margin-left:auto}
h1{font-weight:600;font-size:38px;line-height:1.12;letter-spacing:-.6px;margin:0}
h2{font-weight:600;font-size:17px;letter-spacing:-.2px;margin:0 0 4mm}
.lab{font-size:9px;font-weight:500;letter-spacing:.8px;text-transform:uppercase;color:#8b9390}
.acc{color:${ACC}}
.sub{font-size:8.5px;color:#8b9390;margin-top:1mm}
.hero{display:grid;grid-template-columns:repeat(3,1fr);margin-top:16mm;border-top:1px solid #222826}
.hero>div{padding:6mm 6mm 0 0}
.hero .num{font-weight:600;font-size:46px;letter-spacing:-1.5px;line-height:1.05;margin-top:2mm}
.verdict{font-size:17px;line-height:1.5;color:#d6dbd9;max-width:150mm;margin-top:18mm}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid #222826;margin-bottom:10mm}
.m{padding:5mm 4mm 5mm 0;border-bottom:1px solid #222826}
.m .num{font-weight:600;font-size:26px;letter-spacing:-.8px;margin:1.5mm 0 2mm}
.d{display:block;font-size:9px;margin-top:.6mm}.up{color:${ACC}}.down{color:#e5484d}.muted{color:#8b9390}
.ax{fill:#8b9390;font-size:10px;font-family:Poppins}
.legend{display:flex;gap:16px;font-size:9.5px;color:#c3c8c6;margin-top:2mm}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;font-size:9.8px}
th{text-align:left;color:#8b9390;font-weight:500;font-size:8.5px;letter-spacing:.6px;text-transform:uppercase;padding:2mm 1.5mm;border-bottom:1px solid #222826}
td{padding:2.2mm 1.5mm;border-bottom:1px solid #1a1f1d;vertical-align:middle}
td.n,th.n{text-align:right}
td.rk{font-weight:600;color:${ACC};width:7mm}
.th{width:13mm;height:16mm;object-fit:cover;border-radius:3px;display:block}
td.tt{width:88mm;line-height:1.35}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10mm}
.hb{display:grid;grid-template-columns:40mm 1fr 13mm;align-items:center;gap:3mm;font-size:10px;margin:2.2mm 0}
.ht{height:7px;background:#1a1f1d;border-radius:4px;overflow:hidden}.ht span{display:block;height:100%;background:${ACC};border-radius:4px}
.ht.gray span{background:#6b7280}
.hv{text-align:right;color:#c3c8c6}
.f{display:grid;grid-template-columns:9mm 1fr;padding:5mm 0;border-bottom:1px solid #222826}
.f .i{font-weight:600;color:${ACC};font-size:13px}
.f .t{font-weight:600;font-size:14px;line-height:1.35;margin-bottom:1.5mm}
.f .b{font-size:10.5px;line-height:1.55;color:#c3c8c6}
.foot{position:absolute;bottom:9mm;left:16mm;right:16mm;font-size:8.5px;color:#5c6461;display:flex;justify-content:space-between}
</style></head><body>

<section class="page">
${head(kind)}
<div class="lab" style="margin-top:22mm">${kind}</div>
<h1 style="margin-top:3mm">How <span class="acc">@${esc(account.username)}</span> did<br>from ${dayLabel(data.from)} to ${dayLabel(end)}</h1>
<div class="hero">
<div><div class="lab">Followers</div><div class="num">${fmt(account.followers_count)}</div></div>
<div><div class="lab">New followers</div><div class="num ${newFollowers >= 0 ? 'acc' : ''}">${newFollowers >= 0 ? '+' : ''}${fmt(newFollowers)}</div><div class="sub">Previous period ${prevNew >= 0 ? '+' : ''}${fmt(prevNew)}</div></div>
<div><div class="lab">Posts published</div><div class="num">${posts.length}</div><div class="sub">Previous period ${data.prevPosts.length}</div></div>
</div>
${ai?.verdict ? `<p class="verdict">${esc(ai.verdict)}</p>` : ''}
<div class="foot"><span>Data from the Instagram API, generated ${new Date().toUTCString().slice(5, 22)} UTC</span><span>1</span></div>
</section>

<section class="page">
${head('Numbers')}
<h2>The numbers</h2>
<div class="metrics">${metrics}</div>
<h2>Daily reach</h2>
${reachChart(curReach, prevReach)}
<div class="foot"><span>Each number is compared with the previous ${days} days and with the average of the four periods before.</span><span>2</span></div>
</section>

<section class="page">
${head('Posts')}
<h2>Posts ranked by views</h2>
<table><tr><th></th><th></th><th>Post</th><th class="n">Views</th><th class="n">Reach</th><th class="n">Saves</th><th class="n">Shares</th></tr>${sorted.slice(0, 6).map(row).join('') || '<tr><td colspan="7" class="muted">No posts in this period.</td></tr>'}</table>
${sorted.length > 6 ? `<h2 style="margin-top:9mm">Lowest views</h2><table>${sorted.slice(-3).reverse().map((m, i) => row(m, sorted.length - 1 - i)).join('')}</table>` : ''}
<div class="foot"><span>Views where available, reach otherwise.</span><span>3</span></div>
</section>

<section class="page">
${head('Formats, timing, audience')}
<div class="cols">
<div><h2>By format</h2><div class="sub" style="margin-bottom:2mm">Average views per post</div>${hbars(formats)}</div>
<div><h2>By time slot</h2><div class="sub" style="margin-bottom:2mm">Average views per post, New York time</div>${hbars(slotRows)}</div>
</div>
<h2 style="margin-top:11mm">Followers versus viewers</h2>
<div class="sub" style="margin-bottom:3mm">Left: where followers live (all time). Right: where the accounts reached ${tfLabel} live.</div>
<div class="cols">
<div><div class="lab">Followers by country</div>${hbars(aud.country, sum(aud.country), 6)}</div>
<div><div class="lab">Viewers by country, ${tfLabel}</div>${hbars(rch.country, sum(rch.country), 6)}</div>
<div><div class="lab">Followers by age</div>${hbars(aud.age, sum(aud.age), 5)}</div>
<div><div class="lab">Viewers by age, ${tfLabel}</div>${hbars(rch.age, sum(rch.age), 5)}</div>
</div>
<div class="foot"><span>Country codes: US United States, IN India, DE Germany, GB United Kingdom.</span><span>4</span></div>
</section>

${ai ? `<section class="page">
${head('Analysis')}
<h2>What the numbers say</h2>
${(ai.findings || []).map((f, i) => `<div class="f"><div class="i">${i + 1}</div><div><div class="t">${esc(f.title)}</div><div class="b">${esc(f.body)}</div></div></div>`).join('')}
<h2 style="margin-top:10mm">Next ${days === 7 ? 'week' : 'period'}</h2>
${(ai.actions || []).map((f, i) => `<div class="f"><div class="i">${String.fromCharCode(65 + i)}</div><div><div class="t">${esc(f.title)}</div><div class="b">${esc(f.body)}</div></div></div>`).join('')}
<div class="foot"><span>Written from the numbers in this report only.</span><span>5</span></div>
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
    followers_by_country_count: data.audience.country.slice(0, 5),
    viewers_by_country: data.reached.country.slice(0, 5), viewers_timeframe: data.reached.timeframe,
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
  if (process.env.SEND !== 'false') await sendTelegram(pdf, `📊 NeuraFeed ${days === 7 ? 'weekly' : `${days}-day`} report, until ${end}`);
})().catch((e) => { console.error(e); console.log(`::error::report failed: ${e.message}`); process.exit(1); });
