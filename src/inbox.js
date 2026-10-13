// Links Mahir sends to the Telegram bot. The scheduled Claude run turns new ones into jobs
// (Reel, carousel, single image or prompt carousel).
const fs = require('fs');
const path = require('path');
const { postAtFrom } = require('./when');

const FILE = path.join(__dirname, '..', 'inbox', 'links.json');
const URL_RE = /https?:\/\/[^\s<>"']+/g;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function save(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
}

// Format words Mahir can write anywhere in the message (any case). Turkish and English.
const word = (w) => new RegExp(`(^|[^\\p{L}])(${w})(?=$|[^\\p{L}])`, 'u');
const FORMATS = [
  ['reel', word('reel\\p{L}*')],
  ['single', word('tekli(?!f)\\p{L}*|single')],
  ['prompt', word('prompt\\p{L}*|promt\\p{L}*')],
  ['carousel', word('carousel\\p{L}*|karusel\\p{L}*|karosel\\p{L}*')],
];
function formatOf(note) {
  const t = String(note || '').toLocaleLowerCase('tr');
  const hit = FORMATS.find(([, re]) => re.test(t));
  return hit ? hit[0] : 'auto';
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
      format: formatOf(note),
      post_at: postAtFrom(note, new Date(unixDate * 1000)),
      received_at: new Date(unixDate * 1000).toISOString(),
    };
    list.push(item);
    added.push(item);
  }
  save(list);
  return added;
}

module.exports = { addFromMessage, load, formatOf };
