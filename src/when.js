// Reads a posting time Mahir writes in a Telegram note, in Turkey time unless he says NY.
// "21:30", "21.30'da", "saat 21", "yarın 10:00", "tomorrow 9:15", "NY 18:00". Returns ISO or null.
function tzOffsetMinutes(tz, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}
function postAtFrom(note, now = new Date()) {
  const t = String(note || '').toLocaleLowerCase('tr');
  const m = t.match(/(?:saat\s*)(\d{1,2})(?:[:.](\d{2}))?|(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1] ?? m[3]);
  const min = Number(m[2] ?? m[4] ?? 0);
  if (h > 23 || min > 59) return null;
  const tz = /\b(ny|new york|amerika)\b/.test(t) ? 'America/New_York' : 'Europe/Istanbul';
  const off = tzOffsetMinutes(tz, now);
  const local = new Date(now.getTime() + off * 60000); // wall clock in tz, as UTC fields
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, min) - off * 60000;
  if (/(yarın|yarin|tomorrow)/.test(t)) target += 864e5;
  else if (target < now.getTime() - 5 * 60000) target += 864e5; // time already passed today -> tomorrow
  return new Date(target).toISOString();
}
module.exports = { postAtFrom };
