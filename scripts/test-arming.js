/* eslint-disable */
// Regression test for the real-site FALSE-TRIGGER bug.
//
// Every other test starts on a page that already contains the queue selector — so it can never catch
// the bug we actually hit on texaslonghorns.evenue.net/signin, where the selector is ABSENT until you
// log in and reach the waiting room. Against that, the old "selector absent = your turn" rule fired
// immediately. This test drives the app's REAL monitor decision (dist/backend/session-queue.js's
// evaluateMonitorTick) against a page that mimics the real timeline:
//
//   t=0    selector ABSENT      (sign-in / EID / Duo — you are NOT in the queue)   -> must NOT trigger
//   t~2s   selector APPEARS     (you reached the waiting room)                     -> arm, must NOT trigger
//   t~4s   selector DISAPPEARS  (queue cleared — your turn)                        -> MUST trigger
//
// Uses the same plain puppeteer stack the app uses. Requires `npm run electron:build` first.

const http = require('http');
const puppeteer = require('puppeteer');
const { evaluateMonitorTick } = require('../dist/backend/session-queue.js');

const SELECTOR = '#hlLinkToQueueTicket2Text';
const POLL_MS = 500; // matches main.ts POLL_INTERVAL_MS

// A page that starts WITHOUT the queue element (like the real sign-in page), adds it after 2s
// (waiting room reached), then removes it after another 2s (queue cleared).
const PAGE = `<!doctype html><html><body>
<h1>fake queue timeline</h1>
<script>
  setTimeout(function () {
    var a = document.createElement('a');
    a.id = 'hlLinkToQueueTicket2Text';
    a.textContent = 'View your queue ticket';
    document.body.appendChild(a);
  }, 2000);
  setTimeout(function () {
    var el = document.getElementById('hlLinkToQueueTicket2Text');
    if (el) el.remove();
  }, 4000);
</script>
</body></html>`;

function serve() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  let tick = { armed: false, absentStreak: 0, trigger: false };
  let triggered = false;
  let triggeredAtMs = null;
  let sawElementBeforeTrigger = false;

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    const start = Date.now();

    // Drive the app's REAL monitor decision on a 500ms loop, threading armed + absentStreak between
    // polls exactly like startMonitoring in main.ts.
    while (Date.now() - start < 8000 && !triggered) {
      const elementPresent = await page.evaluate((sel) => document.querySelector(sel) !== null, SELECTOR);
      if (elementPresent) sawElementBeforeTrigger = true;

      tick = evaluateMonitorTick({
        armed: tick.armed,
        elementPresent,
        status: 'monitoring',
        absentStreak: tick.absentStreak,
      });
      if (tick.trigger) {
        triggered = true;
        triggeredAtMs = Date.now() - start;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    const problems = [];
    if (!triggered) problems.push('never triggered even after the element appeared and then disappeared');
    if (triggered && !sawElementBeforeTrigger) problems.push('FALSE TRIGGER: fired without ever seeing the queue element (the original bug)');
    if (triggered && triggeredAtMs != null && triggeredAtMs < 3500)
      problems.push(`triggered too early at ${triggeredAtMs}ms (before the element was removed at ~4000ms)`);

    if (problems.length) {
      console.error('\nFAIL: arming regression —\n - ' + problems.join('\n - '));
      process.exitCode = 1;
    } else {
      console.log(`✓ did NOT false-trigger while the selector was absent at start (sign-in phase)`);
      console.log(`✓ armed after the selector appeared (waiting room reached)`);
      console.log(`✓ triggered only after the selector disappeared (at ~${triggeredAtMs}ms)`);
      console.log('\nPASS: arm-then-trigger prevents the real-site instant false-trigger.');
    }
  } catch (e) {
    console.error('\nFAIL: arming test errored —', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
