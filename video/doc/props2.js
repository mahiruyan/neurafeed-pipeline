// props2.json for the Doc2 render: narration timing, captured real material, sounds.
const fs = require('fs'); const path = require('path');
const A = path.join(__dirname, 'public/assets');
const has = (f) => fs.existsSync(path.join(A, f)) && fs.statSync(path.join(A, f)).size > 1000;
const timing = JSON.parse(fs.readFileSync(path.join(A, 'timing.json'), 'utf8'));
const shots = JSON.parse(fs.readFileSync(path.join(A, 'shots.json'), 'utf8'));
// The live capture can miss (page layout, slow load): fall back to the last good capture.
if (!shots.risk && fs.existsSync(path.join(__dirname, 'fixtures/risk.png'))) {
  fs.copyFileSync(path.join(__dirname, 'fixtures/risk.png'), path.join(A, 'risk.png'));
  shots.risk = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/risk.json'), 'utf8'));
}
const assets = {
  voice: 'assets/voice.mp3', music: has('music.mp3') ? 'assets/music.mp3' : null, whoosh: has('whoosh.mp3') ? 'assets/whoosh.mp3' : null, hit: has('hit.mp3') ? 'assets/hit.mp3' : null,
  dario: 'assets/dario.jpg', darioCut: has('dario-cut.png') ? 'assets/dario-cut.png' : null, darioCredit: shots.person ? shots.person.credit : '',
  footage: has('footage.mp4') ? { src: 'assets/footage.mp4', start: 0, credit: '' } : null,
  building: shots.building ? { src: 'assets/building.jpg', credit: `Photo: ${shots.building.credit}` } : null,
  headline: shots.headline, second: shots.second, risk: shots.risk,
  nfLogo: 'assets/nf-logo.png', anthropicLogo: 'assets/anthropic.png',
};
fs.writeFileSync(path.join(__dirname, 'props2.json'), JSON.stringify({ timing, assets }, null, 2));
console.log(JSON.stringify(assets, null, 1));
