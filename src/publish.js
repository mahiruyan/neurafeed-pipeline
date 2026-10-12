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

async function publishReel(job, files) {
  const base = PUBLIC_BASE.replace(/\/$/, '');
  const c = await graph(`${IG_USER}/media`, {
    media_type: 'REELS',
    video_url: `${base}/${job.id}/${path.basename(files[0])}`,
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

async function publish(job, files) {
  if (instagramEnabled()) return job.type === 'reel' ? publishReel(job, files) : publishInstagram(job, files);
  return publishManual(job, files);
}

module.exports = { publish, instagramEnabled };
