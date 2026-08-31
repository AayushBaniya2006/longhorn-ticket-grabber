/* eslint-disable */
// End-to-end test of the core monitor -> trigger mechanism, without Electron.
//
// It drives a real Puppeteer browser (the same plain puppeteer stack the app uses)
// against the local queue simulator, polling the target selector exactly like main.ts does.
// When the waiting-room element disappears, the app would fire SESSION_TRIGGERED — this asserts
// that detection works.
//
// Run: npm run test:integration

const path = require('path');
const puppeteer = require('puppeteer');
// Drive the app's REAL monitor decision (compiled from src/backend/session-queue.ts) rather than a
// re-implementation, so this test stays honest if the trigger logic changes. Requires
// `npm run electron:build` first.
const { evaluateMonitorTick } = require('../dist/backend/session-queue.js');

const SELECTOR = '#hlLinkToQueueTicket2Text';
const PAGE_URL =
  'file://' + path.join(__dirname, '..', 'dummy-page', 'queue-sim.html') + '?auto=0';

async function elementPresent(page) {
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

    if (!(await elementPresent(page))) {
      throw new Error('waiting-room element was not present on load');
    }
    // Arm from the confirmed-present state, exactly as the app arms while it can see the waiting room.
    let tick = evaluateMonitorTick({ armed: false, elementPresent: true, status: 'monitoring', absentStreak: 0 });
    console.log('✓ waiting-room element present (session ARMED, MONITORING)');

    // Simulate the user advancing past the queue.
    await page.evaluate(() => document.getElementById('advance').click());

    // Poll like the app does (500ms cadence) through the real arm-then-trigger decision, up to 10s.
    // Thread armed + absentStreak between polls, exactly as main.ts persists them on the session.
    let triggered = false;
    for (let i = 0; i < 20; i++) {
      tick = evaluateMonitorTick({
        armed: tick.armed,
        elementPresent: await elementPresent(page),
        status: 'monitoring',
        absentStreak: tick.absentStreak,
      });
      if (tick.trigger) {
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
