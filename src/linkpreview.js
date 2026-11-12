// Saves what a link shows (title, caption text, cover image) for links Claude cannot open itself,
// such as Instagram posts. Runs in GitHub Actions right after a link lands in inbox/links.json.
// Output: item.preview = { title, text, image } and the cover image in inbox/previews/<id>.jpg.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'inbox', 'links.json');
const DIR = path.join(ROOT, 'inbox', 'previews');
// Social sites serve their preview tags (og:title, og:description, og:image) to link-preview bots.
const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re);
  return m ? decode(m[1] || m[2]) : '';
}

// X posts: the page itself shows almost nothing to a bot, so the post's text, the quoted post
// and its photos (full size) come from the public fxtwitter API. Photos land in
// inbox/uploads/<link id>-N.jpg, ready to be used in the post when Mahir asks for the original image.
const UPLOADS = path.join(ROOT, 'inbox', 'uploads');
async function xPost(item) {
  const m = String(item.url).match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/i);
  if (!m) return null;
  const res = await fetch(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NeuraFeedBot/1.0)' } });
  if (!res.ok) return null;
  const t = (await res.json()).tweet;
  if (!t) return null;
  const photos = [...(t.media?.photos || []), ...(t.quote?.media?.photos || [])].map((x) => x.url).filter(Boolean).slice(0, 4);
  const files = [];
  for (const [i, url] of photos.entries()) {
    try {
      const img = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const buf = Buffer.from(await img.arrayBuffer());
      if (!img.ok || buf.length < 5000) continue;
      fs.mkdirSync(UPLOADS, { recursive: true });
      const file = `inbox/uploads/${item.id}-${i + 1}.jpg`;
      fs.writeFileSync(path.join(ROOT, file), buf);
      files.push(file);
    } catch { /* a photo that cannot be fetched is skipped */ }
  }
  return {
    post: { author: t.author?.name || '', handle: t.author?.screen_name || '', text: t.text || '', date: t.created_at || '', has_video: Boolean(t.media?.videos?.length) },
    ...(t.quote ? { quote: { author: t.quote.author?.name || '', handle: t.quote.author?.screen_name || '', text: t.quote.text || '' } } : {}),
    media_files: files,
  };
}

(async () => {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return; }
  let changed = false;
  for (const item of list.filter((l) => !l.preview && l.url)) {
    try {
      const res = await fetch(item.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
      const html = await res.text();
      const preview = {
        title: meta(html, 'og:title') || (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '',
        text: meta(html, 'og:description') || meta(html, 'description'),
        image: meta(html, 'og:image'),
      };
      if (preview.image) {
        const img = await fetch(preview.image, { headers: { 'User-Agent': UA } });
        if (img.ok) {
          fs.mkdirSync(DIR, { recursive: true });
          fs.writeFileSync(path.join(DIR, `${item.id}.jpg`), Buffer.from(await img.arrayBuffer()));
          preview.image_file = `inbox/previews/${item.id}.jpg`;
        }
      }
      try { Object.assign(preview, (await xPost(item)) || {}); } catch (e) { console.log(`::warning::x post details failed for ${item.id}: ${e.message}`); }
      item.preview = preview;
      console.log(`::notice::preview ${item.id}: ${JSON.stringify({ ...preview, text: preview.text.slice(0, 160) }).slice(0, 900)}`);
    } catch (e) {
      item.preview = { error: String(e.message || e) };
      console.log(`::warning::preview failed for ${item.id}: ${e.message}`);
    }
    changed = true;
  }
  if (changed) fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
})();
