/* eslint-disable */
// Multi-session end-to-end test — proves the core invariant that single-session e2e can't:
// only ONE session is PROCESSING at a time, and when it's marked processed the next triggered
// session is promoted. Drives the real app (real IPC, real Puppeteer, real 500ms monitor loop)
// against two sessions on the local queue simulator.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

function startSimServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(__dirname, '..', 'dummy-page', rel === '/' ? 'queue-sim.html' : rel);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const countProcessingBadges = (text) => (text.match(/\bPROCESSING\b/g) || []).length;

(async () => {
  const server = await startSimServer();
  const port = server.address().port;
  // Long enough that both sessions are monitoring before either queue clears.
  const simUrl = `http://127.0.0.1:${port}/queue-sim.html?advanceMs=14000`;

  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, ELECTRON_IS_DEV: '0', NODE_ENV: 'production' },
  });

  const spawnAndReady = async (win, label) => {
    await win.fill('#url', simUrl);
    await win.click('button:has-text("Spawn New Session")');
    // Wait for this spawn to register (session count goes up) then mark it ready.
    await win.waitForFunction(
      (n) => (document.body.innerText.match(/All Sessions \((\d+)\)/) || [])[1] === String(n),
      label,
      { timeout: 120000 },
    );
    await win.click('button:has-text("Session Ready")');
  };

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => document.getElementById('root')?.children.length > 0, null, { timeout: 20000 });

    // Spawn + ready two sessions.
    await spawnAndReady(win, 1);
    await spawnAndReady(win, 2);
    console.log('E2E-multi ✓ two sessions spawned and monitoring');

    // First promotion: one session clears the queue and becomes PROCESSING.
    await win.waitForFunction(() => /Processing Session/i.test(document.body.innerText), null, { timeout: 90000 });
    const firstId = (await win.evaluate(() => document.body.innerText)).match(/Session ID:\s*(session-\d+)/)?.[1];
    console.log(`E2E-multi ✓ first session promoted to PROCESSING (${firstId})`);

    // The second session also triggers, but must NOT start processing while the first is in flight.
    await win.waitForFunction(() => /Ready to Process/i.test(document.body.innerText), null, { timeout: 90000 });
    let text = await win.evaluate(() => document.body.innerText);
    if (countProcessingBadges(text) > 1) throw new Error('two sessions were PROCESSING at once — invariant violated');
    console.log('E2E-multi ✓ second session waited in the ready queue (only one PROCESSING)');

    // Mark the first processed → the second must be promoted.
    await win.click('button:has-text("Mark as Processed")');
    await win.waitForFunction(
      (prev) => {
        const m = document.body.innerText.match(/Session ID:\s*(session-\d+)/);
        return m && m[1] !== prev && /Processing Session/i.test(document.body.innerText);
      },
      firstId,
      { timeout: 60000 },
    );
    const secondId = (await win.evaluate(() => document.body.innerText)).match(/Session ID:\s*(session-\d+)/)?.[1];
    if (!secondId || secondId === firstId) throw new Error('second session was not promoted after the first was processed');
    console.log(`E2E-multi ✓ next session promoted after processing (${secondId})`);

    console.log('\nPASS: one-at-a-time processing + promotion holds across two sessions on ' + process.platform);
  } catch (e) {
    try { console.error('--- UI ---\n' + (await (await app.firstWindow()).evaluate(() => document.body.innerText))); } catch {}
    console.error('\nE2E-MULTI FAILED:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    await app.close();
    server.close();
  }
})();
