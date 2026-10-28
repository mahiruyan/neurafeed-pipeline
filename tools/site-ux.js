// Interaction checks on the live public site (what a reader would notice): menus that do not
// close, small tap targets, controls without a name, forms. Prints one ::notice:: line per finding.
const puppeteer = require('puppeteer');
const BASE = process.argv[2] || 'https://neurafeedai.com';
const out = [];
const note = (ok, text) => { out.push(`${ok ? 'OK ' : 'ISSUE '}${text}`); };

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  // Desktop: search popover.
  {
    const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
    await p.goto(BASE + '/about', { waitUntil: 'networkidle2' });
    const open = () => p.$eval('details.site-search', (d) => d.open).catch(() => null);
    await p.click('details.site-search > summary').catch(() => {});
    note(await open() === true, 'desktop search opens on click');
    const focused = await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    note(focused === 'header-search', `search field gets focus when opened (focused: ${focused})`);
    await p.mouse.click(700, 600); await new Promise((r) => setTimeout(r, 200));
    note(await open() === false, 'search closes when clicking elsewhere');
    await p.click('details.site-search > summary').catch(() => {});
    await p.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 200));
    note(await open() === false, 'search closes with Escape');
    // Keyboard focus is visible.
    await p.keyboard.press('Tab');
    const outline = await p.evaluate(() => { const e = document.activeElement; if (!e) return ''; const s = getComputedStyle(e); return `${s.outlineStyle} ${s.outlineWidth}`; });
    note(!/^none/.test(outline), `keyboard focus is visible (${outline})`);
    await p.close();
  }
  // Phone: mobile menu, tap targets, unnamed controls on key pages.
  for (const path of ['/about', '/advertise', '/latest', '/tools', '/contact']) {
    const p = await b.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(BASE + path, { waitUntil: 'networkidle2' });
    if (path === '/about') {
      await p.tap('details.mobile-nav > summary').catch(() => {});
      note(await p.$eval('details.mobile-nav', (d) => d.open).catch(() => null) === true, 'phone menu opens');
      await p.touchscreen.tap(200, 700); await new Promise((r) => setTimeout(r, 200));
      note(await p.$eval('details.mobile-nav', (d) => d.open).catch(() => null) === false, 'phone menu closes when tapping outside');
      await p.tap('details.mobile-nav > summary').catch(() => {});
      const link = await p.$('details.mobile-nav nav a[href="/latest"]');
      if (link) { await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), link.tap()]); }
      note(await p.$eval('details.mobile-nav', (d) => d.open).catch(() => null) === false, 'phone menu is closed after following a link');
    }
    const small = await p.evaluate(() => Array.from(document.querySelectorAll('a, button, summary, input, select, textarea, label.sponsor-package'))
      .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 32 || r.width < 32) && !e.closest('.prose') && !e.closest('p'); })
      .slice(0, 6).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    note(!small.length, `${path} phone tap targets under 32px: ${small.join(' | ') || 'none'}`);
    const unnamed = await p.evaluate(() => Array.from(document.querySelectorAll('a, button, input, select, textarea, summary'))
      .filter((e) => !(e.textContent || '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title') && !(e.id && document.querySelector(`label[for="${e.id}"]`)) && !e.closest('label') && e.getAttribute('type') !== 'hidden' && e.getBoundingClientRect().width > 0)
      .slice(0, 5).map((e) => e.outerHTML.slice(0, 80)));
    note(!unnamed.length, `${path} controls without a name: ${unnamed.join(' | ') || 'none'}`);
    if (path === '/advertise') {
      const before = await p.$eval('input[name=packages]', (i) => i.checked).catch(() => null);
      await p.tap('label.sponsor-package').catch(() => {});
      const after = await p.$eval('input[name=packages]', (i) => i.checked).catch(() => null);
      note(before === false && after === true, 'package card selects on tap');
      const valid = await p.$eval('form.sponsor-form', (f) => f.checkValidity()).catch(() => null);
      note(valid === false, 'empty sponsorship form is stopped by required fields');
    }
    await p.close();
  }
  // Link page.
  {
    const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await p.goto('https://links.neurafeedai.com/', { waitUntil: 'networkidle2' });
    const hrefs = await p.$$eval('.link-page__list a', (as) => as.map((a) => a.getAttribute('href')));
    note(hrefs.length > 0 && hrefs.every((h) => /^\/go\/l\//.test(h) || /^https:/.test(h)), `link page buttons: ${hrefs.length}`);
    const header = await p.$('.site-header');
    note(!header, 'link page has no site header');
    await p.close();
  }
  // 404 page offers a way back.
  {
    const p = await b.newPage(); await p.goto(BASE + '/nope-' + Date.now(), { waitUntil: 'networkidle2' });
    const back = await p.$$eval('main a', (as) => as.map((a) => a.getAttribute('href')));
    note(back.some((h) => h === '/' || h === '/latest'), `404 page links back (${back.slice(0, 4).join(', ')})`);
    await p.close();
  }
  await b.close();
  for (const line of out) console.log(`::notice::${line}`);
})().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
