// Publishing. Two modes:
//  - "instagram": Instagram API with Instagram Login (graph.instagram.com).
//    Needs IG_USER_ID, IG_ACCESS_TOKEN and PUBLIC_IMAGE_BASE, a public URL under which
//    out/<id>/<n>.jpg can be fetched by Meta (Instagram only accepts JPEG).
//  - "manual" (fallback when Instagram is not configured): sends the final images and
//    caption to Telegram, if Telegram is configured.
const path = require('path');
const tg = require('./telegram');

const VERSION = process.env.GRAPH_VERSION ? `/${process.env.GRAPH_VERSION}` : '';
const GRAPH = `https://graph.instagram.com${VERSION}`;
const IG_USER = process.env.IG_USER_ID;
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const PUBLIC_BASE = process.env.PUBLIC_IMAGE_BASE;
// Videos are served from GitHub Pages so Instagram gets a proper video/mp4 content type.
const VIDEO_BASE = process.env.PUBLIC_VIDEO_BASE || PUBLIC_BASE;

const instagramEnabled = () => Boolean(IG_USER && IG_TOKEN && PUBLIC_BASE);

async function graph(pathname, params) {
  const res = await fetch(`${GRAPH}/${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: IG_TOKEN }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Instagram ${pathname}: ${data.error.message}`);
  return data;
}

async function waitReady(containerId) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(IG_TOKEN)}`);
    const d = await res.json();
    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new Error(`Instagram media status ${d.status_code}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Instagram media processing timed out');
}

async function publishInstagram(job, files) {
  const base = PUBLIC_BASE.replace(/\/$/, '');
  if (files.length === 1) {
    // Single-image post.
    const c = await graph(`${IG_USER}/media`, { image_url: `${base}/${job.id}/${path.basename(files[0])}`, caption: job.caption });
    await waitReady(c.id);
    const pub = await graph(`${IG_USER}/media_publish`, { creation_id: c.id });
    return { mode: 'instagram', media_id: pub.id, type: 'single' };
  }
  const children = [];
  for (const f of files) {
    const c = await graph(`${IG_USER}/media`, { image_url: `${base}/${job.id}/${path.basename(f)}`, is_carousel_item: 'true' });
    children.push(c.id);
  }
  for (const id of children) await waitReady(id);
  const carousel = await graph(`${IG_USER}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: job.caption });
  await waitReady(carousel.id);
  const pub = await graph(`${IG_USER}/media_publish`, { creation_id: carousel.id });
  return { mode: 'instagram', media_id: pub.id };
}

async function waitPublic(url) {
  // GitHub Pages needs a minute or two after a push before the file is live.
  for (let i = 0; i < 18; i++) {
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok) return;
    await new Promise((res) => setTimeout(res, 10000));
  }
  throw new Error(`Video is not reachable yet at ${url}`);
}

async function publishReel(job, files) {
  const url = `${VIDEO_BASE.replace(/\/$/, '')}/${job.id}/${path.basename(files[0])}`;
  await waitPublic(url);
  const c = await graph(`${IG_USER}/media`, {
    media_type: 'REELS',
    video_url: url,
    caption: job.caption,
    share_to_feed: 'true',
  });
  // Videos take a while to process: check every 15 seconds for up to 8 minutes.
  for (let i = 0; i < 32; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const res = await fetch(`${GRAPH}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(IG_TOKEN)}`);
    const d = await res.json();
    if (d.status_code === 'FINISHED') {
      const pub = await graph(`${IG_USER}/media_publish`, { creation_id: c.id });
      return { mode: 'instagram', media_id: pub.id, type: 'reel' };
    }
    if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new Error(`Instagram Reel status ${d.status_code}: ${d.status || ''}`);
  }
  throw new Error('Instagram Reel processing timed out');
}

async function publishManual(job, files) {
  if (!tg.enabled()) throw new Error('Neither Instagram nor Telegram is configured, nowhere to publish');
  await tg.sendMessage(`✅ READY TO POST: ${job.id}\nUpload these files as a carousel. Caption follows.`);
  await tg.sendAlbum(files, true);
  await tg.sendMessage(job.caption);
  return { mode: 'manual' };
}

// ---------- Facebook Page (same post, right after Instagram) ----------
// FB_PAGE_TOKEN is a never-expiring system user token; the page token is looked up each time.
const FB = 'https://graph.facebook.com/v23.0';
async function fbCall(pathname, params, token) {
  const res = await fetch(`${FB}/${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, access_token: token }) });
  const d = await res.json();
  if (d.error) throw new Error(`Facebook ${pathname}: ${d.error.message}`);
  return d;
}
async function fbPage() {
  const sys = process.env.FB_PAGE_TOKEN;
  if (!sys) return null;
  const d = await (await fetch(`${FB}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(sys)}`)).json();
  if (d.error) throw new Error(`Facebook pages: ${d.error.message}`);
  const page = (d.data || []).find((p) => /neurafeed/i.test(p.name)) || d.data?.[0];
  return page ? { id: page.id, token: page.access_token } : null;
}
async function publishFacebook(job, files) {
  const page = await fbPage();
  if (!page) return null;
  const caption = job.caption || '';
  if (job.type === 'reel') {
    const url = `${VIDEO_BASE.replace(/\/$/, '')}/${job.id}/${path.basename(files[0])}`;
    const v = await fbCall(`${page.id}/videos`, { file_url: url, description: caption }, page.token);
    return { id: v.id, type: 'video' };
  }
  const base = PUBLIC_BASE.replace(/\/$/, '');
  const urls = files.map((f) => `${base}/${job.id}/${path.basename(f)}`);
  if (urls.length === 1) {
    const p = await fbCall(`${page.id}/photos`, { url: urls[0], caption }, page.token);
    return { id: p.post_id || p.id, type: 'photo' };
  }
  // Multi-photo post: upload each slide unpublished, then one feed post with all of them in order.
  const ids = [];
  for (const u of urls) ids.push((await fbCall(`${page.id}/photos`, { url: u, published: 'false' }, page.token)).id);
  const params = { message: caption };
  ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const post = await fbCall(`${page.id}/feed`, params, page.token);
  return { id: post.id, type: 'album' };
}

// ---------- Threads (same post, right after Instagram) ----------
// THREADS_TOKEN: long-lived Threads user token (60 days, refreshed by refresh-threads.yml).
const TH = 'https://graph.threads.net/v1.0';
async function thCall(pathname, params) {
  const res = await fetch(`${TH}/${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, access_token: process.env.THREADS_TOKEN }) });
  const d = await res.json();
  if (d.error) throw new Error(`Threads ${pathname}: ${d.error.message}`);
  return d;
}
async function thWait(id, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const d = await (await fetch(`${TH}/${id}?fields=status,error_message&access_token=${encodeURIComponent(process.env.THREADS_TOKEN)}`)).json();
    if (d.status === 'FINISHED') return;
    if (d.status === 'ERROR' || d.status === 'EXPIRED') throw new Error(`Threads media ${d.status}: ${d.error_message || ''}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Threads media processing timed out');
}
// Threads allows 500 characters. Keep the story lines and the Source line, drop hashtags first.
function threadsText(caption) {
  const max = 500;
  let t = String(caption || '').replace(/(^|\s)#\w+/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return t;
  const lines = t.split('\n');
  const src = lines.filter((l) => /^(Source|Video):/i.test(l.trim())).join('\n');
  let body = lines.filter((l) => !/^(Source|Video):/i.test(l.trim()) && !/^Follow @neurafeed/i.test(l.trim())).join('\n').trim();
  const room = max - (src ? src.length + 2 : 0);
  if (body.length > room) body = body.slice(0, room - 3).replace(/\s+\S*$/, '') + '...';
  return src ? `${body}\n\n${src}` : body;
}
async function publishThreads(job, files) {
  if (!process.env.THREADS_TOKEN) return null;
  const text = threadsText(job.caption);
  let creation;
  if (job.type === 'reel') {
    const url = `${VIDEO_BASE.replace(/\/$/, '')}/${job.id}/${path.basename(files[0])}`;
    creation = (await thCall('me/threads', { media_type: 'VIDEO', video_url: url, text })).id;
  } else {
    const base = PUBLIC_BASE.replace(/\/$/, '');
    const urls = files.slice(0, 20).map((f) => `${base}/${job.id}/${path.basename(f)}`);
    if (urls.length === 1) {
      creation = (await thCall('me/threads', { media_type: 'IMAGE', image_url: urls[0], text })).id;
    } else {
      const kids = [];
      for (const u of urls) kids.push((await thCall('me/threads', { media_type: 'IMAGE', image_url: u, is_carousel_item: 'true' })).id);
      for (const k of kids) await thWait(k);
      creation = (await thCall('me/threads', { media_type: 'CAROUSEL', children: kids.join(','), text })).id;
    }
  }
  await thWait(creation, job.type === 'reel' ? 100 : 40);
  const pub = await thCall('me/threads_publish', { creation_id: creation });
  return { id: pub.id, type: job.type === 'reel' ? 'video' : (files.length > 1 ? 'carousel' : 'image') };
}

// Same caption on Instagram in the last 3 days = this job is already out. Used before every publish
// so a run that posted but could not save its state never posts the same thing twice.
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
async function alreadyPosted(job) {
  if (!instagramEnabled() || !job?.caption) return null;
  const res = await fetch(`${GRAPH}/${IG_USER}/media?fields=id,caption,timestamp&limit=25&access_token=${encodeURIComponent(IG_TOKEN)}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  const want = norm(job.caption);
  const since = Date.now() - 3 * 864e5;
  return (d.data || []).find((m) => norm(m.caption) === want && new Date(m.timestamp).getTime() > since) || null;
}

async function publish(job, files) {
  if (!instagramEnabled()) return publishManual(job, files);
  const result = job.type === 'reel' ? await publishReel(job, files) : await publishInstagram(job, files);
  // Facebook is extra: a Facebook problem never undoes or blocks the Instagram post.
  try {
    const fb = await publishFacebook(job, files);
    if (fb) result.facebook = fb;
  } catch (e) {
    result.facebook_error = String(e.message || e).slice(0, 300);
  }
  try {
    const th = await publishThreads(job, files);
    if (th) result.threads = th;
  } catch (e) {
    result.threads_error = String(e.message || e).slice(0, 300);
  }
  return result;
}

module.exports = { publish, instagramEnabled, threadsText, alreadyPosted };
