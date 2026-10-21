// Website drafts that did not come from a desk story have no hero image, and the site cannot
// publish without one. For each draft waiting for review on the site, this makes an illustration
// for NeuraFeed into <media>/site/<articleId>/hero.jpg + hero.json, which the site uses when the
// editor approves. Drafts whose source matches a desk story already get that story's hero.
//   node src/site-heroes.js <media repo dir>
const fs = require('fs');
const path = require('path');
const { deskItems } = require('./deskfeed');
const { illustrateDraft } = require('./hero');

const norm = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/$/, ''); } catch { return String(u || '').trim(); } };

function needsHero(draft, deskLinks, mediaDir) {
  if (!/^[0-9a-f-]{36}$/i.test(String(draft.id))) return false;
  if (fs.existsSync(path.join(mediaDir, 'site', draft.id, 'hero.json'))) return false;
  return !(draft.sources || []).some((s) => deskLinks.has(norm(s.url)));
}

async function listDrafts() {
  const origin = process.env.SITE_ADMIN_ORIGIN; const token = process.env.SITE_REVIEW_TOKEN;
  if (!origin || !token) throw new Error('SITE_ADMIN_ORIGIN or SITE_REVIEW_TOKEN missing');
  const res = await fetch(`${origin}/api/jobs/telegram-review`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{"action":"list"}', signal: AbortSignal.timeout(60000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`site list: ${d.error || res.status}`);
  return d.drafts || [];
}

async function main(mediaDir) {
  const drafts = await listDrafts();
  const deskLinks = new Set(deskItems().filter((i) => i.hero).map((i) => norm(i.link)));
  const todo = drafts.filter((d) => needsHero(d, deskLinks, mediaDir));
  console.log(`${drafts.length} draft(s) waiting, ${todo.length} need a hero`);
  for (const d of todo.slice(0, 6)) {
    try {
      const meta = await illustrateDraft(d.headline || 'AI news', path.join(mediaDir, 'site', d.id));
      console.log(`hero for ${d.id}: ${meta.width}x${meta.height}`);
    } catch (e) { console.log(`::warning::hero for ${d.id}: ${e.message}`); }
  }
}

if (require.main === module) main(process.argv[2] || 'media').catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { needsHero, norm };
