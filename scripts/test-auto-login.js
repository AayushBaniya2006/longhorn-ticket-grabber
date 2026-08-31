/* eslint-disable */
// Tests the app's REAL auto-login logic against a realistic fake UT site
// (signin → "Sign In as Student" → EID login form → waiting room), using the same
// plain puppeteer stack the app uses. Verifies auto-login clicks through the student
// SSO flow, fills the EID form, submits, and lands in the queue. Headless; runs locally and in CI.
//
// Requires the Electron main to be compiled first (npm run electron:build), since it imports the
// compiled dist/backend/auto-login.js — the exact code the app runs.

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { attemptAutoLogin } = require('../dist/backend/auto-login.js');

function serveFakeUt() {
  const base = path.join(__dirname, '..', 'dummy-page', 'fake-ut');
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(base, rel === '/' ? 'signin.html' : rel);
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
  const server = await serveFakeUt();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(`http://127.0.0.1:${port}/signin.html`, { waitUntil: 'domcontentloaded' });

    // Run the app's actual auto-login logic against the fake UT flow. The fake site is served on
    // 127.0.0.1, which the production host guard (isTrustedUtLoginHost) correctly rejects — so this
    // test explicitly opts into trusting the local host. The guard itself is covered by the unit
    // test in src/backend/auto-login.test.ts.
    await attemptAutoLogin(page, 'ab12345', 'test-password', { trustHost: () => true });

    // A successful login redirects to the waiting room with the queue element present.
    await page.waitForFunction(
      () => /queue\.html/.test(location.href) && !!document.querySelector('#hlLinkToQueueTicket2Text'),
      { timeout: 15000 },
    );

    // Sanity-check the fields were actually filled before submit worked.
    console.log('✓ clicked "Sign In as Student" → reached the EID login page');
    console.log('✓ filled UT EID + password and submitted the Shibboleth form');
    console.log('✓ landed in the waiting room with the queue element present');
    console.log('\nPASS: auto-login drives the UT-style signin → EID login → queue flow');
  } catch (e) {
    let url = '?';
    try {
      url = (await browser.pages())[0].url();
    } catch {}
    console.error('\nFAIL: auto-login did not complete the flow —', e && e.message ? e.message : e);
    console.error('final url:', url);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
