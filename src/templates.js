// NeuraFeed slide templates (1080x1350). Each returns an HTML fragment.
// Text wrapped in *asterisks* is highlighted in the accent green.
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FONTS = path.join(ROOT, 'node_modules', '@fontsource');
const ACC = '#10a37f';
const fileUrl = (p) => 'file://' + p;
const logo = fileUrl(path.join(ROOT, 'assets', 'logo.png'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hl = (s) => esc(s).replace(/\*(.+?)\*/g, `<span style="color:${ACC}">$1</span>`);
// Headlines: medium weight, the *highlighted* phrase bold and green.
const hlb = (s) => esc(s).replace(/\*(.+?)\*/g, `<span style="color:${ACC};font-weight:700">$1</span>`);

const fontCss = `
@font-face{font-family:Anton;src:url(${fileUrl(FONTS + '/anton/files/anton-latin-400-normal.woff2')})}
@font-face{font-family:'Bebas Neue';src:url(${fileUrl(FONTS + '/bebas-neue/files/bebas-neue-latin-400-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:400;src:url(${fileUrl(FONTS + '/poppins/files/poppins-latin-400-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:300;src:url(${fileUrl(FONTS + '/poppins/files/poppins-latin-300-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:500;src:url(${fileUrl(FONTS + '/poppins/files/poppins-latin-500-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:700;src:url(${fileUrl(FONTS + '/poppins/files/poppins-latin-700-normal.woff2')})}
@font-face{font-family:Poppins;font-weight:600;src:url(${fileUrl(FONTS + '/poppins/files/poppins-latin-600-normal.woff2')})}
body{margin:0;background:#000}`;

const corner = `<div style="position:absolute;top:40px;left:40px;display:flex;flex-direction:column;align-items:center;gap:2px;z-index:5"><img src="${logo}" style="width:76px;height:76px;filter:drop-shadow(0 2px 8px rgba(0,0,0,.45))"><div style="font-family:Poppins;font-weight:600;font-size:30px;color:#fff;line-height:1;text-shadow:0 0 3px #000,0 0 8px rgba(0,0,0,.9),0 1px 12px rgba(0,0,0,.8)">nf</div></div>`;
const arrow = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;

// Auto-shrink a headline so long titles still fit the band.
function headlineSize(text, base, perLine) {
  const len = text.replace(/\*/g, '').length;
  if (len <= perLine * 3) return base;
  if (len <= perLine * 4) return Math.round(base * 0.86);
  return Math.round(base * 0.74);
}

// Round badges (company logos or a second face) overlaid on the photo, like news accounts use.
// Slide fields: badges: [{ url, fit: "contain" (logo) | "cover" (face), pos, bg }],
// badge_side: "right" | "left", badge_border: "green" | "black" | "white".
// A cut-out (background removed) is shown free unless a shape is set explicitly.
const isFree = (b) => b.shape === 'free' || (b.cutout && !b.shape);
const BORDER = { green: ACC, black: '#000', white: '#fff' };
function badgeItems(s, urls, size) {
  const border = BORDER[s.badge_border] || BORDER.green;
  return urls.map((u, i) => {
    const b = (s.badges || [])[i] || {};
    const fit = b.fit || 'contain';
    // shape "free": a transparent PNG (mascot, product cut-out) sits on the photo with no circle.
    if (isFree(b)) {
      const fs = Math.round(size * (b.scale || 1.25));
      return `<img src="${u}" style="width:${fs}px;height:${fs}px;object-fit:contain;filter:drop-shadow(0 12px 30px rgba(0,0,0,.6));flex-shrink:0">`;
    }
    const pad = fit === 'contain' ? Math.round(size * 0.18) : 0;
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;box-sizing:border-box;border:${Math.round(size / 28)}px solid ${border};background:${b.bg || (fit === 'contain' ? '#fff' : '#000')};overflow:hidden;box-shadow:0 10px 36px rgba(0,0,0,.5);flex-shrink:0">
<img src="${u}" style="width:100%;height:100%;box-sizing:border-box;padding:${pad}px;object-fit:${fit};object-position:${b.pos || 'center'};display:block"></div>`;
  }).join('');
}
// Cover: badges sit on the seam between photo and headline band, overlapping both.
// Free-standing cut-outs (logo, mascot) on the cover, like a magazine collage: each one gets
// its own side ("left" / "right") and optional "top" (px) and "scale".
function freeItems(s, urls) {
  return urls.map((u, i) => {
    const b = (s.badges || [])[i] || {};
    if (!isFree(b)) return '';
    const w = Math.round(330 * (b.scale || 1));
    const side = b.side === 'left' ? 'left' : 'right';
    return `<img src="${u}" style="position:absolute;${side}:40px;top:${b.top || 300}px;width:${w}px;height:${w}px;object-fit:contain;filter:drop-shadow(0 12px 30px rgba(0,0,0,.6));z-index:4">`;
  }).join('');
}

function coverBadges(s, urls) {
  if (!urls || !urls.length) return '';
  const free = freeItems(s, urls);
  const round = urls.filter((_, i) => !isFree((s.badges || [])[i] || {}));
  const roundSpec = (s.badges || []).filter((b) => !isFree(b));
  if (!round.length) return free;
  return free + coverRound({ ...s, badges: roundSpec }, round);
}
function coverRound(s, urls) {
  const size = urls.length > 1 ? 230 : 270;
  const side = s.badge_side === 'left' ? 'left' : 'right';
  return `<div style="position:absolute;${side}:96px;top:${560 - size / 2}px;display:flex;gap:16px;z-index:4">${badgeItems(s, urls, size)}</div>`;
}
// Inner slides: badges sit on the lower edge of the photo, above the heading.
function innerBadges(s, urls) {
  if (!urls || !urls.length) return '';
  const size = urls.length > 1 ? 190 : 220;
  const side = s.badge_side === 'left' ? 'left' : 'right';
  return `<div style="position:absolute;${side}:88px;bottom:150px;display:flex;gap:14px;z-index:4">${badgeItems(s, urls, size)}</div>`;
}

// Headline font for carousels: 'anton' (uppercase, the classic NeuraFeed look) or 'poppins'.
const COVER_FONT = process.env.COVER_FONT || 'anton';
const HEADING_FONT = process.env.HEADING_FONT || 'poppins';
const antonH = (size, align, text) => `<h1 style="margin:0;font-family:Anton;font-weight:400;font-size:${size}px;line-height:1.04;text-transform:uppercase;text-align:${align};letter-spacing:-.5px">${hl(text)}</h1>`;

function cover(s, img, badges) {
  const size = s.size || (COVER_FONT === 'anton' ? headlineSize(s.headline, 88, 22) : headlineSize(s.headline, 66, 26));
  return `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;background:#000;color:#fff">
<img src="${img}" style="position:absolute;top:0;left:0;width:1080px;height:900px;object-fit:cover;object-position:${s.pos || 'center 30%'}">
<div style="position:absolute;top:560px;left:0;width:1080px;height:340px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.85) 70%,#000 100%)"></div>
${coverBadges(s, badges)}
${corner}
<div style="position:absolute;top:840px;left:0;width:1080px;height:510px;box-sizing:border-box;padding:0 56px 52px;display:flex;flex-direction:column;align-items:center;justify-content:space-between">
<div style="width:100%;display:flex;align-items:center;gap:24px"><div style="flex-grow:1;height:3px;background:#fff;opacity:.85"></div><img src="${logo}" style="width:60px;height:60px"><div style="flex-grow:1;height:3px;background:#fff;opacity:.85"></div></div>
${COVER_FONT === 'anton' ? antonH(size, 'center', s.headline) : `<h1 style="margin:0;font-family:Poppins;font-weight:500;font-size:${size}px;line-height:1.18;text-align:center;letter-spacing:-.5px">${hlb(s.headline)}</h1>`}
<div style="display:flex;align-items:center;gap:12px;font-family:'Bebas Neue';font-size:40px;letter-spacing:3px">Swipe for more ${arrow}</div>
</div></div>`;
}

function text(s, img, badges) {
  const paras = (s.paras || []).map((p) => {
    const strong = typeof p === 'object' && p.strong;
    const t = typeof p === 'object' ? p.t : p;
    return `<p style="margin:0;font-family:Poppins;font-size:${s.size || 38}px;line-height:1.42;${strong ? `font-weight:600;color:${ACC}` : 'color:#fff'}">${hl(t)}</p>`;
  }).join('');
  return `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;background:#000;color:#fff;display:flex;flex-direction:column">
<div style="position:relative;flex-grow:1;min-height:420px">
<img src="${img}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${s.pos || 'center 30%'}">
<div style="position:absolute;left:0;right:0;bottom:0;height:200px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,#000 100%)"></div>
${innerBadges(s, badges)}
</div>
${corner}
<div style="box-sizing:border-box;padding:4px 72px 52px;display:flex;flex-direction:column;gap:${s.gap || 22}px">
${HEADING_FONT === 'anton' ? `<h2 style="margin:0;font-family:Anton;font-weight:400;font-size:${s.hsize || 76}px;line-height:1.05;text-transform:uppercase;letter-spacing:-.3px">${hl(s.heading)}</h2>` : `<h2 style="margin:0;font-family:Poppins;font-weight:500;font-size:${s.hsize || 56}px;line-height:1.15;letter-spacing:-.3px">${hlb(s.heading)}</h2>`}
${paras}
<div style="align-self:flex-end;display:flex;align-items:center;gap:12px;margin-top:6px;font-family:'Bebas Neue';font-size:40px;letter-spacing:3px">Keep swiping ${arrow}</div>
</div></div>`;
}

function cta(s, img) {
  return `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;background:#000;color:#fff;display:flex;flex-direction:column">
<div style="position:relative;flex-grow:1;min-height:420px">
<img src="${img}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${s.pos || 'center 25%'}">
<div style="position:absolute;left:0;right:0;bottom:0;height:220px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,#000 100%)"></div>
</div>
${corner}
<div style="box-sizing:border-box;padding:0 80px 64px;display:flex;flex-direction:column;align-items:center;gap:30px;text-align:center">
<p style="margin:0;font-family:Poppins;font-size:38px;line-height:1.4;font-weight:500">${hlb(s.hook)}</p>
<div style="display:flex;flex-direction:column;align-items:center;gap:10px"><div style="font-family:Anton;font-size:124px;line-height:1;text-transform:uppercase;color:${ACC}">Follow this page</div><div style="font-family:'Bebas Neue';font-size:58px;letter-spacing:3px;line-height:1">The future of AI in 60 seconds</div></div>
<div style="display:flex;align-items:center;gap:20px"><div style="width:96px;height:96px;border-radius:50%;box-sizing:border-box;border:4px solid ${ACC};display:flex;align-items:center;justify-content:center"><img src="${logo}" style="width:80px;height:80px"></div><div style="font-family:Poppins;font-size:42px;font-weight:600">@neurafeed.ai</div></div>
<div style="display:flex;align-items:center;gap:14px;padding:14px 32px;border-radius:999px;border:2px solid #4a5056;font-family:Poppins;font-size:27px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>Save this post for later</div>
</div></div>`;
}

function page(slide, imgUrl, badgeUrls = []) {
  const kinds = { cover, text, cta };
  const fn = kinds[slide.kind];
  if (!fn) throw new Error(`Unknown slide kind: ${slide.kind}`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}</style></head><body>${fn(slide, imgUrl, badgeUrls)}</body></html>`;
}

module.exports = { page, fileUrl, fontCss, hl, hlb, logo };
