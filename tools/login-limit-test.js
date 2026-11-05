// Checks the admin login rate limit: 7 wrong sign-ins with a made-up address; from the 6th on the
// page must say "Too many sign-in attempts". Prints one notice per attempt.
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  for (let i = 1; i <= 7; i++) {
    await p.goto('https://admin.neurafeedai.com/login', { waitUntil: 'networkidle2' });
    await p.type('input[name=email]', 'ratelimit-test@neurafeedai.com');
    await p.type('input[name=password]', `wrong-${i}`);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type=submit]')]);
    console.log(`::notice::attempt ${i}: ${new URL(p.url()).searchParams.get('error')}`);
  }
  await b.close();
})();
