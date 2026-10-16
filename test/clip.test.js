const test = require('node:test');
const assert = require('node:assert');
const { parseVtt, align } = require('../src/clip');

const AUTO_VTT = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
so<00:00:01.400><c> today</c><00:00:01.800><c> we</c><00:00:02.100><c> talk</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
so today we talk

00:00:03.010 --> 00:00:05.000 align:start position:0%
so today we talk
about<00:00:03.500><c> the</c><00:00:03.900><c> future</c>
`;

test('auto captions: one entry per word with its own time, rolling repeats ignored', () => {
  const w = parseVtt(AUTO_VTT);
  assert.deepEqual(w.map((x) => x.w), ['so', 'today', 'we', 'talk', 'about', 'the', 'future']);
  assert.deepEqual(w.map((x) => x.t), [1, 1.4, 1.8, 2.1, 3.01, 3.5, 3.9]);
});

test('manual captions: words spread over the cue', () => {
  const w = parseVtt('WEBVTT\n\n00:01:00.000 --> 00:01:04.000\nHello there, General Kenobi\n');
  assert.deepEqual(w.map((x) => x.w), ['hello', 'there', 'general', 'kenobi']);
  assert.deepEqual(w.map((x) => x.t), [60, 61, 62, 63]);
});

// A long "original" with distinct words, and a clip cut from it.
const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
const orig = [];
for (let r = 0; r < 20; r++) words.forEach((w, i) => orig.push({ w: `${w}${r}`, t: r * 100 + i * 0.5 }));

test('finds where a clip sits in the original', () => {
  // Clip = round 7, words 10..35, clip time starts at 2.0 s (a 2-second intro by the reposter).
  const clip = words.slice(10, 36).map((w, i) => ({ w: `${w}7`, t: 2 + i * 0.5, end: 2 + i * 0.5 + 0.4 }));
  const m = align(clip, orig);
  assert.equal(m.ok, true);
  assert.ok(Math.abs(m.start - (700 + 10 * 0.5 - 0.4)) < 0.01, `start ${m.start}`);
  assert.ok(Math.abs(m.end - (700 + 35 * 0.5 + 0.4 + 0.6)) < 0.01, `end ${m.end}`);
  assert.ok(m.score > 0.9);
});

test('tolerates transcription mistakes and an intro the original does not have', () => {
  const clip = [{ w: 'follow', t: 0 }, { w: 'for', t: 0.3 }, { w: 'more', t: 0.6 }, ...words.slice(5, 30).map((w, i) => ({ w: i % 6 === 3 ? 'uh' : `${w}12`, t: 1 + i * 0.5 }))];
  const m = align(clip, orig);
  assert.equal(m.ok, true);
  assert.ok(Math.abs(m.start - (1200 + 5 * 0.5 - 0.4)) < 0.6, `start ${m.start}`);
});

test('a clip from another video does not match', () => {
  const clip = 'the quick brown fox jumps over the lazy dog again and again until night falls'.split(' ').map((w, i) => ({ w, t: i * 0.4 }));
  const m = align(clip, orig);
  assert.ok(!m || !m.ok);
});

test('an edited clip (two parts) is matched to its main part and flagged', () => {
  const a = words.slice(0, 24).map((w, i) => ({ w: `${w}3`, t: i * 0.5 }));
  const b = words.slice(20, 32).map((w, i) => ({ w: `${w}9`, t: 12 + i * 0.5 }));
  const m = align([...a, ...b], orig);
  assert.equal(m.ok, true);
  assert.ok(m.start >= 299 && m.start < 301, `start ${m.start}`);
  assert.equal(m.parts.length, 1);
});
