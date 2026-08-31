/* eslint-disable */
// LIVE PREFLIGHT — the "test it like the real game" tool.
//
// Everything else in this repo tests our code against pages WE wrote (dummy-page/*.html), which all
// hard-code the very selector our monitor looks for. That is circular: it proves our code matches our
// mock, not that it matches UT's real portal. This script points the SAME production stack
// (plain puppeteer + the app's real auto-login) at a REAL url and reports whether our
// assumptions actually hold against the genuine DOM — the only thing that matters on drop day.
//
// Usage:
//   npm run electron:build          # compile dist/backend/auto-login.js first (this reuses it)
//   node scripts/preflight-live.js <real-ticket-url> [--selector '#hlLinkToQueueTicket2Text'] \
//        [--eid EID --password PW] [--watch 900]
//
// Credentials can also come from env: UT_EID / UT_PASSWORD. Duo 2FA is always approved by you, by hand.
// The browser stays OPEN and visible so you can watch the real flow and complete Duo.
//
// What it checks against the REAL page:
//   1. Does auto-login reach the real Shibboleth EID form and the Duo step? (only if creds given)
//   2. Is our monitored selector actually present on the real waiting-room page?
//   3. If not, what queue/ticket-ish elements ARE on the page? (so you can find the real selector)
//   4. Is this a Queue-it / virtual-waiting-room redirect? (breaks the same-page-poll model)
//   5. With --watch, it polls exactly like the app and prints the moment the selector disappears,
//      so you can confirm "element disappears == my turn" on the real system.

const puppeteer = require('puppeteer');

let attemptAutoLogin;
try {
  ({ attemptAutoLogin } = require('../dist/backend/auto-login.js'));
} catch {
  console.error('Could not load dist/backend/auto-login.js — run `npm run electron:build` first.');
  process.exit(1);
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const selector = arg('selector', '#hlLinkToQueueTicket2Text');
const eid = arg('eid', process.env.UT_EID || '');
const password = arg('password', process.env.UT_PASSWORD || '');
const watchSecs = parseInt(arg('watch', '0'), 10);
const POLL_MS = 500; // must match main.ts POLL_INTERVAL_MS so we exercise the real cadence

if (!url) {
  console.error('Usage: node scripts/preflight-live.js <real-ticket-url> [--selector ...] [--eid ... --password ...] [--watch 900]');
  process.exit(1);
}

const line = (s) => console.log(s);
const now = () => new Date().toISOString().slice(11, 19);

(async () => {
  line(`\n=== LIVE PREFLIGHT ===`);
  line(`target url : ${url}`);
  line(`selector   : ${selector}`);
  line(`auto-login : ${eid ? 'yes (EID ' + eid + ')' : 'no (manual — log in by hand in the window)'}`);
  line(`watch      : ${watchSecs ? watchSecs + 's' : 'off (one-shot snapshot)'}\n`);

  // Same visible, non-headless launch the app uses, so what you see == what the app would drive.
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000'],
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());

    line(`[${now()}] navigating…`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    line(`[${now()}] landed on: ${page.url()}`);

    // 1. Auto-login (the app's real logic) if creds were supplied.
    if (eid && password) {
      line(`[${now()}] running the app's attemptAutoLogin()…`);
      await attemptAutoLogin(page, eid, password);
      line(`[${now()}] auto-login returned — approve Duo in the window if prompted.`);
    } else {
      line(`[${now()}] no creds given — log in manually in the browser window, then come back here.`);
    }

    // Give you time to finish login/Duo and reach the waiting room before we diagnose.
    const settle = eid ? 45 : 120;
    line(`[${now()}] waiting ${settle}s for you to reach the waiting room (Duo, etc.)…`);
    await new Promise((r) => setTimeout(r, settle * 1000));

    // 2/3/4. Diagnose the real DOM.
    const diag = await page.evaluate((sel) => {
      const q = (s) => document.querySelector(s);
      const asText = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const rx = /queue|ticket|waiting|enter|proceed|continue|buy|purchase/i;
      const candidates = Array.from(document.querySelectorAll('a,button,input[type=submit],[id],[class]'))
        .filter((e) => rx.test((e.id || '') + ' ' + (e.className || '') + ' ' + (e.textContent || '')))
        .slice(0, 25)
        .map((e) => ({
          tag: e.tagName.toLowerCase(),
          id: e.id || null,
          cls: (typeof e.className === 'string' ? e.className : '') || null,
          text: asText(e),
        }));
      // Queue-it markers: separate host, or its telltale script/cookie/markup.
      const html = document.documentElement.outerHTML;
      const queueItSigns = {
        host: location.hostname,
        looksLikeQueueIt:
          /queue-it\.net/i.test(location.hostname) ||
          /queue-it|Queue-it|QueueITAccepted/i.test(html),
      };
      return {
        href: location.href,
        title: document.title,
        selectorPresent: !!q(sel),
        candidates,
        queueItSigns,
      };
    }, selector);

    line(`\n=== REAL-PAGE DIAGNOSIS ===`);
    line(`final url   : ${diag.href}`);
    line(`page title  : ${diag.title}`);
    line(`host        : ${diag.queueItSigns.host}`);
    line(`selector "${selector}" present? : ${diag.selectorPresent ? 'YES ✅' : 'NO ❌'}`);

    if (diag.queueItSigns.looksLikeQueueIt) {
      line(`\n⚠️  QUEUE-IT / VIRTUAL WAITING ROOM DETECTED.`);
      line(`    The real queue lives on a separate host and redirects when it's your turn. Our`);
      line(`    "poll one selector on the same page" model does NOT fit this — the app would need to`);
      line(`    detect the redirect off the queue host instead. This is the #1 thing to design around.`);
    }

    if (!diag.selectorPresent) {
      line(`\n❌ Our monitored selector is NOT on the real page. The disappear-trigger would never fire.`);
      line(`   Candidate queue/ticket-ish elements actually present (pick the real one, pass via --selector):`);
      if (!diag.candidates.length) line(`   (none found — you may not be on the waiting-room page yet)`);
      diag.candidates.forEach((c) =>
        line(`   - <${c.tag}> id=${c.id || '—'}  class="${(c.cls || '').slice(0, 40)}"  "${c.text}"`),
      );
    } else {
      line(`\n✅ Selector present. Note whether "my turn" makes it DISAPPEAR (our model) vs. change/enable.`);
    }

    // 5. Watch the real transition, exactly like the app's monitor loop.
    if (watchSecs > 0) {
      line(`\n=== WATCH (${watchSecs}s, polling every ${POLL_MS}ms like the app) ===`);
      const deadline = Date.now() + watchSecs * 1000;
      let lastPresent = null;
      while (Date.now() < deadline) {
        let present;
        try {
          present = await page.evaluate((sel) => document.querySelector(sel) !== null, selector);
        } catch {
          line(`[${now()}] page navigating/closed during poll (this itself is real-world signal).`);
          present = false;
        }
        if (present !== lastPresent) {
          line(`[${now()}] selector present = ${present}${lastPresent === true && !present ? '  → THIS is what fires SESSION_TRIGGERED' : ''}`);
          lastPresent = present;
        }
        if (lastPresent === true && !present) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      line(`[${now()}] watch ended.`);
    }

    line(`\nDone. The browser stays open so you can inspect. Ctrl+C here to quit.`);
    await new Promise(() => {}); // hold open
  } catch (e) {
    console.error(`\nPREFLIGHT ERROR:`, e && e.message ? e.message : e);
    process.exitCode = 1;
    await browser.close().catch(() => {});
  }
})();
