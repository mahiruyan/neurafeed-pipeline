// Full-page screenshots of the public site at phone and desktop widths, plus a quick page report
// (title, description, h1 count, images without alt, console errors, broken links on the page).
const fs = require('fs'); const path = require('path'); const puppeteer = require('puppeteer');
const BASE = process.argv[2] || 'https://neurafeedai.com';
const OUT = process.argv[3] || 'shots';
const PAGES = ['/', '/latest', '/news/anthropic-reportedly-tests-ai-model-that-infers-users-unstated-goals-2b9fb1', '/category/models', '/search?q=anthropic', '/tools', '/advertise', '/about', '/editorial-policy', '/ai-use', '/masthead', '/contact', '/privacy', '/terms', '/this-page-does-not-exist', 'https://links.neurafeedai.com/'];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const report = [];
  for (const [name, vp] of [['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { width: 1440, height: 900, deviceScaleFactor: 1 }]]) {
    for (const p of PAGES) {
      const page = await b.newPage(); await page.setViewport(vp);
      if (name === 'phone') await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
      const t0 = Date.now();
      const res = await page.goto(p.startsWith('http') ? p : BASE + p, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => null);
      const ms = Date.now() - t0;
      const info = await page.evaluate(() => ({
        title: document.title, desc: document.querySelector('meta[name=description]')?.content || '',
        h1: document.querySelectorAll('h1').length, imgsNoAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2, height: document.documentElement.scrollHeight,
        fonts: [...new Set([...document.querySelectorAll('h1,h2,p,a,body')].map((e) => getComputedStyle(e).fontFamily.split(',')[0]))].slice(0, 6),
        links: [...new Set([...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')))].slice(0, 60),
      })).catch(() => ({}));
      const file = `${name}${p.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || '_home'}.jpg`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true, type: 'jpeg', quality: 70 }).catch(() => {});
      report.push({ view: name, page: p, status: res?.status(), ms, ...info, errors });
      await page.close();
    }
  }
  // Check every internal link found once.
  const links = [...new Set(report.flatMap((r) => r.links || []))];
  const broken = [];
  for (const l of links) { const r = await fetch(BASE + l, { redirect: 'manual' }).catch(() => null); if (!r || r.status >= 400) broken.push(`${l} ${r?.status}`); }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ report: report.map(({ links: _, ...r }) => r), broken }, null, 2));
  console.log(JSON.stringify({ broken }, null, 1));
})();
