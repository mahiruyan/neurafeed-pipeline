// Git merge driver for the small queue files in inbox/ (JSON arrays of objects with an id).
// The Telegram bot appends to them through the GitHub API while Actions mark items done, so a
// rebase can see both sides change the same file. Instead of a conflict (which used to make the
// save step fail and lose state), items are merged by id:
//   - an item added on either side is kept
//   - an item changed on both sides gets the fields of both (a finished "done" always wins)
//   - an item deleted on one side (Actions prune old finished items) stays deleted
// Usage (set up by scripts/save.sh): git config merge.jsonlist.driver "node src/mergelist.js %O %A %B"
const fs = require('fs');

const keyOf = (x) => (x && typeof x === 'object' ? x.id || x.link_id || x.url || JSON.stringify(x) : JSON.stringify(x));
const read = (f) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(v) ? v : null; } catch { return null; } };

// Field by field: a side that changed a field (compared with the base) wins; if both changed it,
// a set value beats an empty one ("done": time beats "done": false).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = (v) => v === undefined || v === null || v === false || v === '';
function mergeItem(base, x, y) {
  if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return y;
  const b = base && typeof base === 'object' ? base : {};
  const m = {};
  for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const xc = !same(x[f], b[f]);
    const yc = !same(y[f], b[f]);
    let v;
    if (xc && !yc) v = x[f];
    else if (yc && !xc) v = y[f];
    else v = empty(y[f]) ? x[f] : y[f];
    if (v !== undefined) m[f] = v;
  }
  return m;
}

function merge(base, ours, theirs) {
  const b = new Map(base.map((x) => [keyOf(x), x]));
  const o = new Map(ours.map((x) => [keyOf(x), x]));
  const t = new Map(theirs.map((x) => [keyOf(x), x]));
  const out = [];
  const seen = new Set();
  for (const k of [...o.keys(), ...t.keys()]) {
    if (seen.has(k)) continue;
    seen.add(k);
    const inO = o.has(k);
    const inT = t.has(k);
    if (b.has(k) && (!inO || !inT)) continue; // deleted on one side
    if (inO && inT) out.push(mergeItem(b.get(k), o.get(k), t.get(k))); else out.push(inO ? o.get(k) : t.get(k));
  }
  return out;
}

module.exports = { merge, mergeItem };

if (require.main === module) {
  const [O, A, B] = process.argv.slice(2);
  const base = read(O) || [];
  const ours = read(A);
  const theirs = read(B);
  if (!ours || !theirs) process.exit(1); // not a JSON list: let git report a normal conflict
  fs.writeFileSync(A, JSON.stringify(merge(base, ours, theirs), null, 2) + '\n');
  process.exit(0);
}
