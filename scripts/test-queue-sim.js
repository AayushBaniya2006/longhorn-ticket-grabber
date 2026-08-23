/* eslint-disable */
// End-to-end test of the core monitor -> trigger mechanism, without Electron.
//
// It drives a real Puppeteer browser (the same puppeteer-extra + stealth stack the app uses)
// against the local queue simulator, polling the target selector exactly like main.ts does.
// When the waiting-room element disappears, the app would fire SESSION_TRIGGERED — this asserts
// that detection works.
//
// Run: npm run test:integration

const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const SELECTOR = '#hlLinkToQueueTicket2Text';
const PAGE_URL =
  'file://' + path.join(__dirname, '..', 'dummy-page', 'queue-sim.html') + '?auto=0';

// Mirrors the polling check in src/backend/main.ts.
async function elementExists(page) {
  return page.evaluate((sel) => document.querySelector(sel) !== null, SELECTOR);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });

    if (!(await elementExists(page))) {
      throw new Error('waiting-room element was not present on load');
    }
    console.log('✓ waiting-room element present (session would start MONITORING)');

    // Simulate the user advancing past the queue.
    await page.evaluate(() => document.getElementById('advance').click());

    // Poll like the app does (500ms cadence), up to 10s.
    let triggered = false;
    for (let i = 0; i < 20; i++) {
      if (!(await elementExists(page))) {
        triggered = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!triggered) {
      throw new Error('element never disappeared — app would NOT trigger');
    }
    console.log('✓ element disappeared → app fires SESSION_TRIGGERED');
    console.log('\nPASS: end-to-end monitor/trigger mechanism works.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('\nFAIL:', e.message);
  process.exit(1);
});
