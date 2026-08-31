/* eslint-disable */
// TWO-PROFILE PREFLIGHT — the one test that decides whether this project works at all.
//
// The whole app rests on a single unverified assumption: that a queue position is held per BROWSER
// SESSION, not per STUDENT ACCOUNT. If it's per-session, N isolated profiles = N independent draws
// and parallelism helps. If it's per-account, all N profiles share one position (or evict each
// other) and the app cannot improve your odds no matter how many windows it opens.
//
// preflight-live.js drives ONE session, so it can never answer this. This drives TWO, with fully
// separate userDataDirs, and reports whether they end up in the same queue slot or different ones.
//
// Usage:
//   node scripts/preflight-two-profile.js <queue-url> [--selector '#hlLinkToQueueTicket2Text'] \
//        [--login-secs 300] [--watch 900]
//
// You log in BY HAND in both windows (same EID both times — that is the point of the test).
// Credentials are never read or typed by this script.
//
// READ THE VERDICT AT THE BOTTOM. The three outcomes:
//   DIFFERENT positions  -> per-session. Parallelism works. Build the seed-profile flow.
//   SAME position        -> per-account. The app cannot help; stop here.
//   ONE EVICTED          -> per-account AND actively single-session. Worse than useless: a second
//                           window would cost you the position you already had.

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const selector = arg('selector', '#hlLinkToQueueTicket2Text');
const loginSecs = parseInt(arg('login-secs', '300'), 10);
const watchSecs = parseInt(arg('watch', '0'), 10);
const POLL_MS = 500; // match main.ts POLL_INTERVAL_MS

if (!url) {
  console.error(
    'Usage: node scripts/preflight-two-profile.js <queue-url> [--selector ...] [--login-secs 300] [--watch 900]',
  );
  process.exit(1);
}

const line = (s) => console.log(s);
const now = () => new Date().toISOString().slice(11, 19);

// Never print a session cookie value. A short hash is enough to compare two profiles.
const fingerprint = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12);

// Cookies that plausibly carry queue/session identity on Paciolan/eVenue + common waiting rooms.
const IDENTITY_COOKIE_RX = /sess|queue|jsession|asp\.net|token|patron|auth|sso|shib|_px|perimeter/i;

/** Text on the page that looks like a queue position / wait estimate. */
async function readQueueSignals(page, sel) {
  return page
    .evaluate((s) => {
      const rx = /(position|you are|ahead of you|in line|number|wait|queue|approximately|estimated)/i;
      const numRx = /\d{1,7}/;
      const seen = new Set();
      const hits = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (el.children.length) continue; // leaf nodes only, avoids duplicating parent text
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!t || t.length > 160) continue;
        if (!rx.test(t)) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        // The count is often in a sibling/wrapper ("<span id=n>412</span> people ahead of you"),
        // so fall back to the parent's text when the leaf itself carries no number.
        let number = (t.match(numRx) || [null])[0];
        let context = t;
        if (!number && el.parentElement) {
          const pt = (el.parentElement.textContent || '').trim().replace(/\s+/g, ' ');
          if (pt.length <= 240) {
            number = (pt.match(numRx) || [null])[0];
            if (number) context = pt;
          }
        }
        if (seen.has(context)) continue; // several leaves can roll up to the same parent
        seen.add(context);
        hits.push({ text: context, number });
        if (hits.length >= 12) break;
      }
      return {
        href: location.href,
        host: location.hostname,
        title: document.title,
        selectorPresent: !!document.querySelector(s),
        bodyLen: document.body ? document.body.innerText.length : 0,
        hits,
      };
    }, sel)
    .catch((e) => ({ error: e.message }));
}

async function snapshot(label, page, sel) {
  const sig = await readQueueSignals(page, sel);
  let cookies = [];
  try {
    // CDP form works whether or not this puppeteer version exposes page.cookies().
    const client = await page.createCDPSession();
    const res = await client.send('Network.getAllCookies');
    cookies = (res.cookies || [])
      .filter((c) => IDENTITY_COOKIE_RX.test(c.name))
      .map((c) => ({ name: c.name, domain: c.domain, fp: fingerprint(c.value) }))
      .sort((a, b) => (a.name + a.domain).localeCompare(b.name + b.domain));
    await client.detach().catch(() => {});
  } catch (e) {
    cookies = [{ name: `(cookie read failed: ${e.message})`, domain: '', fp: '' }];
  }
  return { label, ...sig, cookies };
}

function printSnapshot(s) {
  line(`\n--- ${s.label} ---`);
  if (s.error) {
    line(`  ERROR: ${s.error}`);
    return;
  }
  line(`  url       : ${s.href}`);
  line(`  title     : ${s.title}`);
  line(`  selector "${selector}" present? ${s.selectorPresent ? 'YES' : 'NO'}`);
  line(`  identity cookies:`);
  if (!s.cookies.length) line(`    (none matched)`);
  s.cookies.forEach((c) => line(`    ${c.name} @ ${c.domain} -> ${c.fp}`));
  line(`  queue-ish text on page:`);
  if (!s.hits.length) line(`    (none found — are you actually in the waiting room?)`);
  s.hits.forEach((h) => line(`    ${h.number ? '[' + h.number + '] ' : ''}${h.text}`));
}

/** The whole point: compare the two snapshots and say what it means. */
function verdict(a, b) {
  line(`\n${'='.repeat(70)}`);
  line(`VERDICT — is the queue position per-SESSION or per-ACCOUNT?`);
  line(`${'='.repeat(70)}`);

  const aCookies = new Map(a.cookies.map((c) => [`${c.name}@${c.domain}`, c.fp]));
  const bCookies = new Map(b.cookies.map((c) => [`${c.name}@${c.domain}`, c.fp]));
  const shared = [...aCookies.keys()].filter((k) => bCookies.has(k));
  const identical = shared.filter((k) => aCookies.get(k) === bCookies.get(k));

  line(`\n1. Session identity`);
  line(`   shared cookie names : ${shared.length}`);
  line(`   with IDENTICAL value: ${identical.length}${identical.length ? '  -> ' + identical.join(', ') : ''}`);
  if (shared.length && identical.length === 0) {
    line(`   => The two profiles carry DISTINCT session tokens. Good sign for per-session.`);
  } else if (identical.length) {
    line(`   => Profiles share a token value. They are NOT independent — suspect per-account.`);
  } else {
    line(`   => No comparable cookies. Inconclusive; rely on the position numbers below.`);
  }

  const aNums = a.hits.map((h) => h.number).filter(Boolean);
  const bNums = b.hits.map((h) => h.number).filter(Boolean);
  line(`\n2. Queue position numbers`);
  line(`   profile A: ${aNums.length ? aNums.join(', ') : '(none seen)'}`);
  line(`   profile B: ${bNums.length ? bNums.join(', ') : '(none seen)'}`);

  const overlap = aNums.filter((n) => bNums.includes(n));
  if (!aNums.length || !bNums.length) {
    line(`\n   INCONCLUSIVE — no position numbers on one or both pages.`);
    line(`   Either you are not in the waiting room yet, or the position is not rendered as text.`);
    line(`   Re-run during a real drop, and eyeball both windows yourself.`);
  } else if (overlap.length === aNums.length && overlap.length === bNums.length) {
    line(`\n   SAME POSITION -> PER-ACCOUNT.`);
    line(`   Both profiles landed in the identical slot. Extra sessions are copies of one draw;`);
    line(`   the app cannot improve your odds. Do not build the seed-profile flow.`);
  } else {
    line(`\n   DIFFERENT POSITIONS -> PER-SESSION.`);
    line(`   Two isolated profiles hold two independent slots. Parallelism genuinely works,`);
    line(`   and the seed-profile flow is worth building.`);
  }

  line(`\n3. Eviction check`);
  if (a.selectorPresent === false && b.selectorPresent === true) {
    line(`   WARNING: profile A lost the queue element while B holds it.`);
    line(`   If A was in the queue first, logging in twice may have EVICTED it. That would make a`);
    line(`   second window actively harmful. Confirm by watching A's window directly.`);
  } else {
    line(`   No obvious eviction (both profiles' selector state: A=${a.selectorPresent} B=${b.selectorPresent}).`);
  }
  line(`\n${'='.repeat(70)}\n`);
}

(async () => {
  line(`\n=== TWO-PROFILE PREFLIGHT ===`);
  line(`target url : ${url}`);
  line(`selector   : ${selector}`);
  line(`login time : ${loginSecs}s (log in BY HAND in BOTH windows, same EID)\n`);

  const profiles = ['A', 'B'].map((id) => ({
    id,
    dir: fs.mkdtempSync(path.join(os.tmpdir(), `lhtg-preflight-${id}-`)),
  }));

  const browsers = [];
  try {
    for (const p of profiles) {
      // Separate userDataDir per profile == separate cookie jar. This mirrors main.ts SPAWN_SESSION.
      const browser = await puppeteer.launch({
        headless: false,
        userDataDir: p.dir,
        defaultViewport: null,
        args: [`--window-size=900,900`, `--window-position=${p.id === 'A' ? 0 : 920},0`],
      });
      browsers.push(browser);
      const page = (await browser.pages())[0] || (await browser.newPage());
      p.page = page;
      line(`[${now()}] profile ${p.id}: navigating (profile dir: ${p.dir})`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      line(`[${now()}] profile ${p.id}: landed on ${page.url()}`);
    }

    line(`\n>>> Log in with the SAME UT EID in BOTH windows now, and get BOTH into the queue.`);
    line(`>>> Waiting ${loginSecs}s. Ctrl+C to abort.\n`);
    await new Promise((r) => setTimeout(r, loginSecs * 1000));

    const snapA = await snapshot('PROFILE A', profiles[0].page, selector);
    const snapB = await snapshot('PROFILE B', profiles[1].page, selector);
    printSnapshot(snapA);
    printSnapshot(snapB);
    verdict(snapA, snapB);

    // Optional: watch both, exactly like the app's monitor, to see whether they advance independently.
    if (watchSecs > 0) {
      line(`=== WATCH (${watchSecs}s, polling both every ${POLL_MS}ms like the app) ===`);
      const deadline = Date.now() + watchSecs * 1000;
      const last = { A: null, B: null };
      while (Date.now() < deadline) {
        for (const p of profiles) {
          let present;
          try {
            present = await p.page.evaluate((s) => document.querySelector(s) !== null, selector);
          } catch {
            present = false; // navigating or closed — itself real-world signal
          }
          if (present !== last[p.id]) {
            const fired = last[p.id] === true && !present ? '  <- this is what fires SESSION_TRIGGERED' : '';
            line(`[${now()}] ${p.id}: selector present = ${present}${fired}`);
            last[p.id] = present;
          }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      line(`[${now()}] watch ended.`);
      line(`\nIf ONE profile cleared while the other kept waiting, that is direct proof of`);
      line(`independent per-session queue positions — the strongest evidence this test can give.`);
    }

    line(`\nBrowsers stay open so you can inspect. Ctrl+C to quit.`);
    await new Promise(() => {});
  } catch (e) {
    console.error(`\nPREFLIGHT ERROR:`, e && e.message ? e.message : e);
    process.exitCode = 1;
    for (const b of browsers) await b.close().catch(() => {});
  } finally {
    // Profiles hold post-login UT SSO cookies — wipe them, same policy as main.ts removeSessionProfile.
    process.on('exit', () => {
      for (const p of profiles) fs.rmSync(p.dir, { recursive: true, force: true });
    });
  }
})();
