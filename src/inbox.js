// Links Mahir sends to the Telegram bot. The scheduled Claude run turns new ones into Reel jobs.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'inbox', 'links.json');
const URL_RE = /https?:\/\/[^\s<>"']+/g;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function save(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
}

function addFromMessage(text, extraUrls, messageId, unixDate) {
  const urls = [...new Set([...(String(text || '').match(URL_RE) || []), ...(extraUrls || [])])]
    .map((u) => u.replace(/[).,]+$/, ''));
  if (!urls.length) return [];
  const note = String(text || '').replace(URL_RE, '').trim();
  const list = load();
  const added = [];
  for (const url of urls) {
    if (list.some((l) => l.url === url)) continue;
    const item = {
      id: `link-${new Date(unixDate * 1000).toISOString().slice(0, 10)}-${messageId}${urls.length > 1 ? `-${added.length + 1}` : ''}`,
      url,
      note,
      received_at: new Date(unixDate * 1000).toISOString(),
    };
    list.push(item);
    added.push(item);
  }
  save(list);
  return added;
}

module.exports = { addFromMessage, load };
