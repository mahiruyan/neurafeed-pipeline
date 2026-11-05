// Cover A/B test: tells the desk which variant a new job gets, so half the posts use each one.
// Usage: node tools/abtest.js <job id> [person]
//   headline: "short" = 10 words or fewer on the cover; "long" = 12 to 18 words.
//   photo (only with "person", a story about someone in the face library):
//     "face" = their face library photo; "story" = the best real photo from the source article.
// The variant comes from the job id, so it is stable and roughly 50/50. Prints the "ab" object
// to put in the job file. Results: the "Cover A/B report" workflow (tools/ab-report.js).
const crypto = require('crypto');
const [id, person] = process.argv.slice(2);
if (!id) { console.error('usage: node tools/abtest.js <job id> [person]'); process.exit(1); }
const h = crypto.createHash('sha1').update(String(id)).digest();
const ab = { headline: h[0] % 2 ? 'short' : 'long' };
if (person) ab.photo = h[1] % 2 ? 'face' : 'story';
console.log(JSON.stringify({ ab }));
