// Long-term memory shared by the Telegram assistant (DeepSeek) and the Claude news desk.
// memory/notes.json is the source of truth; memory/notes.md is the readable copy Claude reads.
// Usage: node src/memory.js <add|replace|delete|prune> [json]
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'memory');
const JSON_FILE = path.join(DIR, 'notes.json');
const MD_FILE = path.join(DIR, 'notes.md');
const MAX = 50;
const CATS = {
  editorial: 'Editorial preferences',
  rule: 'Standing instructions',
  decision: 'Past decisions',
  ops: 'Operational facts',
};

const load = () => { try { return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')); } catch { return []; } };
const today = () => new Date().toISOString().slice(0, 10);
const alive = (n) => !n.expires_at || n.expires_at >= today();

function render(notes) {
  const lines = [
    '# NeuraFeed memory',
    '',
    'Mahir\'s standing preferences, instructions, past decisions and operational facts, saved from',
    'Telegram. Follow them in every run. They override the defaults in CLAUDE.md, but never the',
    '"Rules that must never be broken" (no invented facts, no copying, no dashes, credit sources).',
    '',
  ];
  for (const [cat, title] of Object.entries(CATS)) {
    const items = notes.filter((n) => n.category === cat);
    if (!items.length) continue;
    lines.push(`## ${title}`, '');
    for (const n of items) lines.push(`- ${n.text} _(${n.id}, saved ${n.created_at.slice(0, 10)}${n.expires_at ? `, until ${n.expires_at}` : ''})_`);
    lines.push('');
  }
  if (!notes.length) lines.push('_(empty)_', '');
  return lines.join('\n');
}

function save(notes) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(JSON_FILE, JSON.stringify(notes, null, 2) + '\n');
  fs.writeFileSync(MD_FILE, render(notes));
}

function apply(op, input = {}) {
  let notes = load().filter(alive);
  const before = notes.length;
  if (op === 'prune') { save(notes); return `pruned ${before - notes.length} expired`; }
  if (op === 'delete') {
    notes = notes.filter((n) => n.id !== input.id);
    save(notes);
    return notes.length < before ? `deleted ${input.id}` : `not found ${input.id}`;
  }
  if (!CATS[input.category]) throw new Error(`category must be one of ${Object.keys(CATS).join(', ')}`);
  if (!String(input.text || '').trim()) throw new Error('text is empty');
  const note = {
    id: input.id && op === 'replace' ? input.id : `m${Date.now().toString(36)}`,
    category: input.category,
    text: String(input.text).trim().slice(0, 400),
    created_at: new Date().toISOString(),
    expires_at: /^\d{4}-\d{2}-\d{2}$/.test(input.expires_at || '') ? input.expires_at : null,
    source: String(input.source || 'telegram').slice(0, 200),
  };
  if (op === 'replace') {
    const i = notes.findIndex((n) => n.id === input.id);
    if (i < 0) throw new Error(`not found ${input.id}`);
    notes[i] = note;
  } else {
    if (notes.length >= MAX) throw new Error(`memory is full (${MAX}); delete or merge notes first`);
    notes.push(note);
  }
  save(notes);
  return `${op} ${note.id}: ${note.text}`;
}

module.exports = { apply, load, render };

if (require.main === module) {
  const [op, raw] = process.argv.slice(2);
  try {
    console.log(`::notice::${apply(op, raw ? JSON.parse(raw) : {})}`);
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
