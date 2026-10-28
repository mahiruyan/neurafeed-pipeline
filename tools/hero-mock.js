// Mockups of article header layouts on a live article, for choosing a design. Usage: node tools/hero-mock.js <url> <outdir>
const fs = require('fs'); const path = require('path'); const puppeteer = require('puppeteer');
const URL_ = process.argv[2]; const OUT = process.argv[3] || 'mock';
const VARIANTS = {
  now: { css: '', js: '' },
  a_behind: {
    js: `const h=document.querySelector('.article-header'); const img=document.querySelector('.article-hero img'); const src=img.currentSrc||img.src; const credit=document.querySelector('.article-hero-credit'); h.classList.add('mock-a'); h.style.setProperty('--bg','url("'+src+'")'); document.querySelector('.article-hero').style.display='none'; if(credit){const c=credit.cloneNode(true);c.className='mock-credit';h.appendChild(c);}`,
    css: `.mock-a{position:relative;max-width:none!important;width:100%!important;margin:0!important;min-height:82vh;display:flex;flex-direction:column;justify-content:flex-end;padding:48px max(24px,calc((100vw - 1180px)/2)) 40px!important;background:linear-gradient(180deg,rgba(0,0,0,.05) 0%,rgba(0,0,0,.25) 40%,rgba(0,0,0,.86) 100%),var(--bg) center/cover no-repeat;color:#fff;text-align:left!important;align-items:flex-start!important}
.mock-a *{color:#fff!important;text-align:left!important;border-color:rgba(255,255,255,.35)!important}
.mock-a .breadcrumbs{position:absolute;top:24px;left:max(24px,calc((100vw - 1180px)/2));justify-content:flex-start!important;opacity:.85}
.mock-a .story-kicker{color:#5ef0c4!important}
.mock-a h1{font-size:clamp(40px,6vw,88px)!important;max-width:15ch;margin-left:0!important;text-shadow:0 2px 24px rgba(0,0,0,.35)}
.mock-a .article-dek{max-width:60ch;margin-left:0!important;opacity:.92}
.mock-a .article-meta{width:100%;max-width:none}
.mock-credit{position:absolute;right:16px;bottom:10px;font-size:11px!important;opacity:.6;margin:0}`
  },
  b_side: {
    js: `const h=document.querySelector('.article-header'); const hero=document.querySelector('.article-hero'); const wrap=document.createElement('div'); wrap.className='mock-b page-shell'; h.parentNode.insertBefore(wrap,h); wrap.appendChild(h); wrap.appendChild(hero);`,
    css: `.mock-b{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;padding-top:32px;padding-bottom:32px}
.mock-b .article-header,.mock-b .article-hero{max-width:none!important;width:auto!important;margin:0!important;padding:0!important;text-align:left!important}
.mock-b .article-header *{text-align:left!important;justify-content:flex-start!important;margin-left:0!important}
.mock-b h1{font-size:clamp(36px,4vw,60px)!important}
.mock-b .article-hero img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}
@media (max-width:800px){.mock-b{grid-template-columns:1fr;gap:20px}.mock-b .article-hero{order:-1}}`
  },
  c_photo_first: {
    js: `const h=document.querySelector('.article-header'); const hero=document.querySelector('.article-hero'); h.parentNode.insertBefore(hero,h); hero.classList.add('mock-c'); h.classList.add('mock-c-h');`,
    css: `.mock-c{max-width:none!important;width:100%!important;padding:0!important;margin:0!important}
.mock-c img{width:100%;height:62vh!important;object-fit:cover}
.mock-c .article-hero-credit{max-width:1180px;margin:6px auto 0;padding:0 24px;text-align:right;font-size:12px}
.mock-c-h{text-align:left!important}.mock-c-h *{text-align:left!important;justify-content:flex-start!important;margin-left:0!important}
.mock-c-h h1{font-size:clamp(36px,5vw,72px)!important;max-width:18ch}`
  },
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  for (const [name, vp] of [['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { width: 1440, height: 900, deviceScaleFactor: 1 }]]) {
    for (const [v, { css, js }] of Object.entries(VARIANTS)) {
      if (process.env.MOCK_ONLY && !process.env.MOCK_ONLY.split(',').includes(v)) continue;
      const page = await b.newPage(); await page.setViewport(vp);
      if (process.env.MOCK_IMG) await page.setBypassCSP(true);
      try {
      await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 });
      if (process.env.MOCK_IMG) await page.evaluate((src) => document.querySelectorAll('.article-cover__media img, .lead-visual img, .article-hero img').forEach((i) => { i.removeAttribute('srcset'); i.removeAttribute('sizes'); i.src = src; }), process.env.MOCK_IMG).catch(() => {});
      if (js) await page.evaluate(js).catch(() => {});
      if (css) await page.addStyleTag({ content: css });
      await page.evaluate(() => document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }));
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({ path: path.join(OUT, `${v}-${name}.jpg`), type: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: vp.width, height: name === 'phone' ? 1100 : 1000 }, captureBeyondViewport: true });
      } catch (e) { console.log(`::error::${v}-${name}: ${e.message}`); }
      await page.close();
    }
  }
  await b.close();
})();
