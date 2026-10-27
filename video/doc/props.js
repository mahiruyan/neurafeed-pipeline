// Builds props.json for the render from script.json, the narration timing and the captured shots.
const fs = require('fs'); const path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(__dirname, '../sample/script.json'), 'utf8'));
const A = path.join(__dirname, 'public/assets');
const timing = JSON.parse(fs.readFileSync(path.join(A, 'timing.json'), 'utf8'));
const shots = JSON.parse(fs.readFileSync(path.join(A, 'shots.json'), 'utf8'));
fs.writeFileSync(path.join(__dirname, 'props.json'), JSON.stringify({ timing, captions: s.captions, assets: { walkout: 'assets/walkout.jpg', dario: 'assets/dario.jpg', voice: 'assets/voice.mp3', ...shots } }, null, 2));
