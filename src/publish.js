// Publishing. Two modes:
//  - "instagram": Instagram Graph API carousel. Needs IG_USER_ID, IG_ACCESS_TOKEN and
//    PUBLIC_IMAGE_BASE (a public URL where out/<id>/<n>.png can be fetched by Meta).
//  - "manual" (default until the above exist): sends the final PNGs as files plus the
//    caption to Telegram so Mahir can post them by hand in a minute.
const path = require('path');
const tg = require('./telegram');

const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v21.0'}`;
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
  if (data.error) throw new Error(`Graph ${pathname}: ${data.error.message}`);
  return data;
}

async function waitReady(containerId) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${IG_TOKEN}`);
    const d = await res.json();
    if (d.status_code === 'FINISHED') return;
    if (d.status_code === 'ERROR') throw new Error('Instagram could not process the media');
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Instagram media processing timed out');
}

async function publishInstagram(job, files) {
  const children = [];
  for (const f of files) {
    const url = `${PUBLIC_BASE.replace(/\/$/, '')}/${job.id}/${path.basename(f)}`;
    const c = await graph(`${IG_USER}/media`, { image_url: url, is_carousel_item: 'true' });
    children.push(c.id);
  }
  const carousel = await graph(`${IG_USER}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: job.caption });
  await waitReady(carousel.id);
  const pub = await graph(`${IG_USER}/media_publish`, { creation_id: carousel.id });
  return { mode: 'instagram', media_id: pub.id };
}

async function publishManual(job, files) {
  await tg.sendMessage(`✅ READY TO POST: ${job.id}\nUpload these files as a carousel. Caption follows.`);
  await tg.sendAlbum(files, true);
  await tg.sendMessage(job.caption);
  return { mode: 'manual' };
}

async function publish(job, files) {
  if (instagramEnabled()) return publishInstagram(job, files);
  return publishManual(job, files);
}

module.exports = { publish, instagramEnabled };
