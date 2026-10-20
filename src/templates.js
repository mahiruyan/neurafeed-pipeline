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
  const size = s.size || (COVER_FONT === 'anton' ? headlineSize(s.headline, 100, 19) : headlineSize(s.headline, 74, 23));
  return `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;background:#000;color:#fff">
<img src="${img}" style="position:absolute;top:0;left:0;width:1080px;height:900px;object-fit:cover;object-position:${s.pos || 'center 30%'}">
<div style="position:absolute;top:560px;left:0;width:1080px;height:340px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.85) 70%,#000 100%)"></div>
${coverBadges(s, badges)}
${corner}
<div style="position:absolute;top:840px;left:0;width:1080px;height:510px;box-sizing:border-box;padding:0 56px 52px;display:flex;flex-direction:column;align-items:center;justify-content:space-between">
<div style="width:100%;display:flex;align-items:center;gap:24px"><div style="flex-grow:1;height:3px;background:#fff;opacity:.85"></div><img src="${logo}" style="width:60px;height:60px"><div style="flex-grow:1;height:3px;background:#fff;opacity:.85"></div></div>
${COVER_FONT === 'anton' ? antonH(size, 'center', s.headline) : `<h1 style="margin:0;font-family:Poppins;font-weight:500;font-size:${size}px;line-height:1.18;text-align:center;letter-spacing:-.5px">${hlb(s.headline)}</h1>`}
${s.single ? `<div style="font-family:'Bebas Neue';font-size:46px;letter-spacing:3px">Follow <span style="color:${ACC}">@neurafeed.ai</span> for daily AI news</div>` : `<div style="display:flex;align-items:center;gap:12px;font-family:'Bebas Neue';font-size:46px;letter-spacing:3px">Swipe for more ${arrow}</div>`}
</div></div>`;
}

function text(s, img, badges) {
  const paras = (s.paras || []).map((p) => {
    const strong = typeof p === 'object' && p.strong;
    const t = typeof p === 'object' ? p.t : p;
    return `<p style="margin:0;font-family:Poppins;font-size:${s.size || 43}px;line-height:1.38;${strong ? `font-weight:600;color:${ACC}` : 'color:#fff'}">${hl(t)}</p>`;
  }).join('');
  return `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;background:#000;color:#fff;display:flex;flex-direction:column">
<div style="position:relative;flex-grow:1;min-height:420px">
<img src="${img}" style="position:absolute;inset:0;width:100%;height:100%;${s.image?.fit === 'contain' ? 'box-sizing:border-box;padding:130px 48px 150px;object-fit:contain' : 'object-fit:cover'};object-position:${s.pos || 'center 30%'}">
<div style="position:absolute;left:0;right:0;bottom:0;height:200px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,#000 100%)"></div>
${innerBadges(s, badges)}
</div>
${corner}
<div style="box-sizing:border-box;padding:4px 72px 52px;display:flex;flex-direction:column;gap:${s.gap || 22}px">
${HEADING_FONT === 'anton' ? `<h2 style="margin:0;font-family:Anton;font-weight:400;font-size:${s.hsize || 76}px;line-height:1.05;text-transform:uppercase;letter-spacing:-.3px">${hl(s.heading)}</h2>` : `<h2 style="margin:0;font-family:Poppins;font-weight:500;font-size:${s.hsize || 64}px;line-height:1.12;letter-spacing:-.3px">${hlb(s.heading)}</h2>`}
${paras}
<div style="align-self:flex-end;display:flex;align-items:center;gap:12px;margin-top:6px;font-family:'Bebas Neue';font-size:46px;letter-spacing:3px">Keep swiping ${arrow}</div>
</div></div>`;
}

// ---------- Card-style inner slides (like evolving.ai, uncover.ai, chatgptricks) ----------
// Dark background, text on top, the picture as a rounded card. Every one carries the small
// NeuraFeed tag at the top right and the slide counter at the bottom right.
const DARK = 'radial-gradient(120% 80% at 50% 0%,#15181b 0%,#0a0b0c 60%)';
const tag = `<div style="position:absolute;top:44px;right:48px;display:flex;align-items:center;gap:12px;z-index:5"><img src="${logo}" style="width:54px;height:54px"><div style="font-family:Poppins;line-height:1.1"><div style="font-weight:600;font-size:24px;color:#fff">Neurafeed AI</div><div style="font-size:20px;color:#8a9096">@neurafeed.ai</div></div></div>`;
// No page counter (1/5 ...) on slides: Mahir asked to remove it.
const counter = () => '';
const dark = (s, inner) => `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;background:${DARK};color:#fff">${inner}${counter(s)}</div>`;
const paraText = (p) => (typeof p === 'object' ? p.t : p);
const para = (p, size, color = '#d6dadd') => {
  const strong = typeof p === 'object' && p.strong;
  return `<p style="margin:0;font-family:Poppins;font-size:${size}px;line-height:1.45;${strong ? `font-weight:600;color:${ACC}` : `color:${color}`}">${hl(paraText(p))}</p>`;
};
const chars = (list) => list.map(paraText).join(' ').length;

// card: numbered or plain heading, short text, the picture as a rounded card, an optional note.
function card(s, img) {
  const paras = s.paras || [];
  const long = chars(paras) + (s.note || '').length;
  const size = s.size || (long > 330 ? 34 : long > 220 ? 37 : 40);
  const imgH = long > 330 ? 350 : long > 220 ? 420 : 500;
  const fit = s.image?.fit === 'contain' ? `object-fit:contain;background:#000` : 'object-fit:cover';
  return dark(s, `${tag}
<div style="position:absolute;top:130px;bottom:96px;left:60px;right:60px;display:flex;flex-direction:column;justify-content:center;gap:28px">
<h2 style="margin:0;font-family:Poppins;font-weight:700;font-size:${s.hsize || 64}px;line-height:1.15;letter-spacing:-.3px">${hl(s.heading)}</h2>
${paras.map((p) => para(p, size)).join('')}
${img ? `<img src="${img}" style="width:960px;height:${imgH}px;${fit};object-position:${s.pos || 'center 30%'};border-radius:28px;border:1px solid #2a2e33;flex-shrink:0">` : ''}
${s.note ? para(s.note, size - 4, '#9aa1a7') : ''}
</div>`);
}

// product: big picture on top, a big colored title and the text below (one item of a list).
function product(s, img) {
  const paras = s.paras || [];
  const size = s.size || (chars(paras) > 220 ? 38 : 42);
  return dark(s, `<img src="${img}" style="position:absolute;top:0;left:0;width:1080px;height:760px;${s.image?.fit === 'contain' ? 'object-fit:contain;background:#000' : 'object-fit:cover'};object-position:${s.pos || 'center 30%'}">
<div style="position:absolute;top:540px;left:0;width:1080px;height:230px;background:linear-gradient(180deg,rgba(10,11,12,0),#0a0b0c)"></div>
<img src="${logo}" style="position:absolute;top:40px;left:40px;width:70px;height:70px;filter:drop-shadow(0 2px 8px rgba(0,0,0,.5))">
<div style="position:absolute;top:780px;bottom:96px;left:60px;right:60px;display:flex;flex-direction:column;gap:22px">
<h2 style="margin:0;font-family:Anton;font-weight:400;font-size:${s.hsize || headlineSize(s.heading, 92, 20)}px;line-height:1.02;color:${ACC};text-transform:uppercase">${esc(s.heading).replace(/\*/g, '')}</h2>
${paras.map((p) => para(p, size, '#e6e9eb')).join('')}
</div>`);
}

// post: a real post (X, Threads, a blog) shown as a card, its text word for word.
const check = `<svg width="30" height="30" viewBox="0 0 24 24"><path fill="#1d9bf0" d="M22.5 12.5c0-1.6-.9-3-2.2-3.7.2-.4.2-.9.2-1.3 0-2.2-1.7-4-3.9-4-.5 0-1 .1-1.4.3C14.6 2.4 13.4 1.5 12 1.5s-2.6.9-3.2 2.3c-.4-.2-.9-.3-1.4-.3-2.2 0-3.9 1.8-3.9 4 0 .5.1.9.2 1.3-1.3.7-2.2 2.1-2.2 3.7 0 1.5.8 2.8 2 3.6-.1.3-.1.6-.1.9 0 2.2 1.7 4 3.9 4 .5 0 1-.1 1.4-.3.6 1.4 1.8 2.3 3.2 2.3s2.6-.9 3.2-2.3c.4.2.9.3 1.4.3 2.2 0 3.9-1.8 3.9-4 0-.3 0-.6-.1-.9 1.2-.8 2.2-2.1 2.2-3.6z"/><path fill="#fff" d="M10.5 16.3 7 12.8l1.4-1.4 2.1 2.1 5-5 1.4 1.4z"/></svg>`;
function post(s, img) {
  const a = s.author || {};
  const text = String(s.text || '').replace(/\s*[\u2013\u2014]\s*/g, ' - ');
  const size = s.size || (text.length > 260 ? 35 : text.length > 160 ? 39 : 42);
  const avatar = s._avatar
    ? `<img src="${fileUrl(s._avatar)}" style="width:84px;height:84px;border-radius:50%;object-fit:cover">`
    : `<div style="width:84px;height:84px;border-radius:50%;background:#2a2e33;display:flex;align-items:center;justify-content:center;font-family:Poppins;font-weight:700;font-size:36px">${esc((a.name || '?').trim()[0])}</div>`;
  return dark(s, `${tag}
<div style="position:absolute;top:150px;bottom:110px;left:60px;right:60px;display:flex;flex-direction:column;justify-content:center">
${s.heading ? `<h2 style="margin:0 0 28px;font-family:Poppins;font-weight:700;font-size:${s.hsize || 56}px;line-height:1.15">${hl(s.heading)}</h2>` : ''}
<div style="background:#111315;border:1px solid #2a2e33;border-radius:32px;padding:40px">
<div style="display:flex;align-items:center;gap:18px">${avatar}
<div style="font-family:Poppins;line-height:1.2"><div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:32px">${esc(a.name || '')}${a.verified ? check : ''}</div><div style="font-size:26px;color:#8a9096">${esc(a.handle || '')}${s.platform ? ` · ${esc(s.platform)}` : ''}</div></div></div>
<p style="margin:26px 0 0;font-family:Poppins;font-size:${size}px;line-height:1.42;color:#f0f2f3;white-space:pre-line">${esc(text)}</p>
${img ? `<img src="${img}" style="margin-top:28px;width:880px;height:${text.length > 200 ? 380 : 470}px;${s.image?.fit === 'contain' ? 'object-fit:contain;background:#000' : 'object-fit:cover'};object-position:${s.pos || 'center 30%'};border-radius:22px">` : ''}
${s.date ? `<div style="margin-top:20px;font-family:Poppins;font-size:24px;color:#6b7177">${esc(s.date)}</div>` : ''}
</div></div>`);
}

// prompt: what the trick is, the prompt in a chat box, what it does.
function prompt(s) {
  const paras = s.paras || [];
  const send = `<div style="width:62px;height:62px;border-radius:50%;background:${ACC};display:flex;align-items:center;justify-content:center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></div>`;
  const plen = String(s.prompt || '').length;
  return dark(s, `${tag}
<div style="position:absolute;top:150px;bottom:110px;left:60px;right:60px;display:flex;flex-direction:column;justify-content:center;gap:36px">
<h2 style="margin:0;font-family:Poppins;font-weight:700;font-size:${s.hsize || 62}px;line-height:1.15;color:${ACC}">${esc(s.heading || '').replace(/\*/g, '')}</h2>
${paras[0] ? para(paras[0], 40, '#e6e9eb') : ''}
<div style="background:#1b1e21;border:1px solid #30353a;border-radius:36px;padding:38px 40px 30px">
<div style="font-family:Poppins;font-size:${plen > 300 ? 31 : plen > 160 ? 35 : 40}px;line-height:1.42;color:#fff;white-space:pre-line">${esc(s.prompt || '')}</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:40px"><div style="font-size:44px;color:#9aa1a7;font-family:Poppins">+</div>${send}</div></div>
${paras.slice(1).map((p) => para(p, 37)).join('')}
</div>`);
}

// summary: the key points, short.
function summary(s) {
  const pts = s.points || s.paras || [];
  const size = s.size || (chars(pts) > 380 ? 36 : 40);
  return dark(s, `${tag}
<div style="position:absolute;top:150px;bottom:110px;left:60px;right:60px;display:flex;flex-direction:column;justify-content:center;gap:32px">
<h2 style="margin:0 0 6px;font-family:Anton;font-weight:400;font-size:${s.hsize || 84}px;line-height:1.02;text-transform:uppercase">${hl(s.heading || 'The short version')}</h2>
${pts.map((t) => `<div style="display:flex;gap:22px"><div style="width:14px;height:14px;border-radius:50%;background:${ACC};margin-top:${Math.round(size * 0.55)}px;flex-shrink:0"></div>${para(t, size, '#eceff1')}</div>`).join('')}
</div>`);
}

// cta: follow and save, with the account card (real numbers when the pipeline could read them)
// and one line tied to this story.
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n));
function cta(s) {
  const acc = s._account || {};
  const stats = [acc.posts ? [short(acc.posts), 'posts'] : null, acc.followers ? [short(acc.followers), 'followers'] : null, ['Daily', 'AI news']].filter(Boolean);
  return dark(s, `<div style="position:absolute;top:110px;left:0;right:0;text-align:center;font-family:Anton;font-size:118px;color:${ACC};line-height:1">FOLLOW FOR MORE</div>
<div style="position:absolute;top:290px;left:110px;right:110px;background:#111315;border:2px solid #3a3f44;border-radius:36px;padding:44px">
<div style="display:flex;align-items:center;gap:40px"><img src="${logo}" style="width:150px;height:150px;border-radius:50%">
<div style="display:flex;gap:46px;font-family:Poppins;text-align:center">${stats.map(([a, b]) => `<div><div style="font-weight:700;font-size:40px">${a}</div><div style="font-size:24px;color:#9aa1a7">${b}</div></div>`).join('')}</div></div>
<div style="margin-top:26px;font-family:Poppins;font-weight:600;font-size:32px">Neurafeed AI</div>
<div style="font-family:Poppins;font-size:26px;color:#9aa1a7;margin-top:6px">@neurafeed.ai · The AI news that matters, every day.</div>
<div style="display:flex;gap:18px;margin-top:30px"><div style="flex:1;background:#3b6bf6;border-radius:14px;padding:18px;text-align:center;font-family:Poppins;font-weight:600;font-size:28px">Follow</div><div style="flex:1;background:#2a2e33;border-radius:14px;padding:18px;text-align:center;font-family:Poppins;font-weight:600;font-size:28px">Message</div></div>
</div>
${s.hook ? `<p style="position:absolute;top:840px;left:90px;right:90px;margin:0;text-align:center;font-family:Poppins;font-size:40px;line-height:1.35;font-weight:500">${hlb(s.hook)}</p>` : ''}
<div style="position:absolute;bottom:90px;left:0;right:0;text-align:center;font-family:Anton;font-size:110px;line-height:1">SAVE FOR LATER</div>`);
}

function page(slide, imgUrl, badgeUrls = []) {
  const kinds = { cover, text, cta, card, product, post, prompt, summary };
  const fn = kinds[slide.kind];
  if (!fn) throw new Error(`Unknown slide kind: ${slide.kind}`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}</style></head><body>${fn(slide, imgUrl, badgeUrls)}</body></html>`;
}

module.exports = { page, fileUrl, fontCss, hl, hlb, logo };
