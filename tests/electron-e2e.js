/* eslint-disable */
// ACTUAL end-to-end test — not a smoke test.
//
// It drives the real app through its whole workflow and asserts each transition:
//   Spawn New Session  -> a REAL Puppeteer Chromium launches and navigates to a local queue page
//   Session Ready      -> the app starts MONITORING the queue element
//   (queue clears)     -> the waiting-room element auto-removes; the app must fire the trigger and
//                         promote the session to PROCESSING
//   Mark as Processed  -> the session becomes PROCESSED
//
// This exercises the real IPC, the real Puppeteer spawn, and the real 500ms monitoring loop against
// a locally-served copy of the queue simulator (no external network dependency).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

function startSimServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(__dirname, '..', 'dummy-page', rel === '/' ? 'queue-sim.html' : rel);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await startSimServer();
  const port = server.address().port;
  // The queue element auto-removes 8s after the page loads — enough time to click Session Ready first.
  const simUrl = `http://127.0.0.1:${port}/queue-sim.html?advanceMs=8000`;

  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, ELECTRON_IS_DEV: '0', NODE_ENV: 'production' },
  });

  const dumpUi = async (label) => {
    try {
      const w = await app.firstWindow();
      console.error(`--- UI at ${label} ---\n` + (await w.evaluate(() => document.body.innerText)));
    } catch {}
  };

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => document.getElementById('root')?.children.length > 0, null, {
      timeout: 20000,
    });

    // Point the app at the local queue simulator.
    await win.fill('#url', simUrl);

    // 1) Spawn a real session — this launches Puppeteer and navigates to the sim.
    await win.click('button:has-text("Spawn New Session")');
    await win.waitForFunction(() => /\bACTIVE\b/.test(document.body.innerText), null, {
      timeout: 120000,
    });
    console.log('E2E ✓ session spawned (ACTIVE) — real Puppeteer browser launched + navigated');

    // 2) Session Ready -> start monitoring.
    await win.click('button:has-text("Session Ready")');
    console.log('E2E ✓ session marked ready — monitoring started');

    // 3) The sim removes the queue element after 8s -> app must trigger + promote to processing.
    await win.waitForFunction(
      () => /Processing Session/i.test(document.body.innerText),
      null,
      { timeout: 90000 },
    );
    console.log('E2E ✓ queue cleared -> session TRIGGERED and promoted to PROCESSING');

    // 4) Mark processed.
    await win.click('button:has-text("Mark as Processed")');
    await win.waitForFunction(() => /\bPROCESSED\b/.test(document.body.innerText), null, {
      timeout: 30000,
    });
    console.log('\nPASS: full spawn → monitor → trigger → process flow works on ' + process.platform);
  } catch (e) {
    await dumpUi('failure');
    console.error('\nE2E TEST FAILED:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    await app.close();
    server.close();
  }
})();
