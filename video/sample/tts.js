// Narration with ElevenLabs (with timestamps) -> voice.mp3 + timing.json (sentence start/end seconds).
// Usage: ELEVENLABS_API_KEY=... node video/sample/tts.js video/sample/script.json out/dir
const fs = require('fs');
const path = require('path');

async function main() {
  const [scriptFile, outDir] = process.argv.slice(2);
  const s = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const text = s.sentences.join(' ');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${s.voice_id}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: s.model_id || 'eleven_multilingual_v2', voice_settings: s.settings }),
  });
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY secret is empty');
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = await res.json();
  fs.writeFileSync(path.join(outDir, 'voice.mp3'), Buffer.from(d.audio_base64, 'base64'));
  const a = d.alignment || d.normalized_alignment;
  const starts = a.character_start_times_seconds; const ends = a.character_end_times_seconds;
  let off = 0;
  const sentences = s.sentences.map((t) => {
    const i = text.indexOf(t, off); const j = i + t.length - 1; off = j + 1;
    return { start: starts[Math.min(i, starts.length - 1)], end: ends[Math.min(j, ends.length - 1)] };
  });
  const timing = { duration: ends[ends.length - 1], sentences };
  fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing, null, 2));
  console.log(JSON.stringify(timing));
}
main().catch((e) => { console.log(`::error::${e.message.replace(/\n/g, ' ')}`); process.exit(1); });
