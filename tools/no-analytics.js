// Our own test browsers must not count as readers: block Google Analytics on a puppeteer page.
// (hero-mock keeps it when MOCK_PROBE is set, because that run checks that analytics works.)
module.exports = async function noAnalytics(page) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*googletagmanager.com*', '*google-analytics.com*', '*analytics.google.com*'] });
};
