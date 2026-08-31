# 🤘 Longhorn Ticket Grabber

Grab **UT Austin student football tickets** by running your own queue sessions side by side. When
tickets drop, the ticketing site puts everyone in a waiting-room queue. This app opens several queue
sessions at once and watches all of them — the moment one clears the queue, it brings that window to
the front so you can buy.

> ⚠️ **Read this before you expect magic.** This automates *your own* browser windows in a public
> queue. It does **not** bypass login, payment, or the site's bot check — you sign in, clear any
> "Press & Hold" human check, and check out yourself. It won't defeat anti-bot protection, and it
> can't promise better odds. See **[Does this actually work?](#does-this-actually-work-read-this-first)**
> before you rely on it. Check the ticketing site's Terms of Service first, and don't share accounts
> you're not allowed to.

## Does this actually work? Read this first

Two honest limits, up front, so you're not surprised:

**1. It does not beat bot detection.** UT's real ticketing site (`texaslonghorns.evenue.net`) is
protected by PerimeterX / HUMAN Security. When an automated browser reaches it, the site shows a
**"Press & Hold to confirm you are a human"** challenge and denies the page until a person clears it.
This app **detects** that challenge, flags the session (**"Needs you: Press & Hold"**), and brings its
window to the front so *you* can clear it by hand. It does **not** solve, suppress, or evade the
check — by design, and that won't change. Firing many automated sessions at once tends to make the
block *more* likely, not less, because anti-bot systems correlate parallel sessions from one machine.

**2. "More sessions = better odds" is unproven — and may be false.** The UT Big Ticket claim is a
**login-first random lottery**. If the draw is **per-account** (one entry per EID), then ten windows
logged into your one account are still **one entry** — no multiplier. Parallel sessions only help if
the draw is **per-session** (each browser gets its own independent position), and nobody has verified
which it is. `npm run preflight:two` (below) is the only way to find out, at a real drop. Until then,
treat "more sessions" as an assumption, not a promise.

The mechanics — spawn, monitor, trigger, tile, promote — genuinely work (proven end to end against
the bundled queue simulator). Whether they translate into an *edge* on the real site is the open
question above.

---

## ⬇️ Download & use (no coding needed)

1. **Go to the [Releases page](https://github.com/AayushBaniya2006/longhorn-ticket-grabber/releases/latest).**
2. Download the file for your computer:
   - **Mac (Apple Silicon — M1/M2/M3/M4):** the file ending in **`.dmg`**
     (`Longhorn-Ticket-Grabber-Mac-AppleSilicon-<version>.dmg` — the version number is in the filename,
     so you can tell a fresh download from a cached old one). Intel Macs aren't supported by the
     prebuilt download yet — build from source (below).
   - **Windows:** the file ending in **`.exe`**
   - **Updating from an older version?** Drag the old app from **Applications → Trash first**, then
     install the new one. Reopening a stale copy (or a browser-cached old download) is the #1 reason
     "it didn't update."
3. **Open it.** Because the app isn't paid-signed yet, your computer may warn you the first time:
   - **Mac:** right-click (or Control-click) the app → **Open** → **Open** again. Then, so it can move
     the browser windows for you, allow it under *System Settings → Privacy & Security →
     **Accessibility*** when prompted.
   - **Windows:** if you see "Windows protected your PC", click **More info → Run anyway**.
4. **Use it:**
   1. The **Ticket page link** and **Queue element to watch** boxes are pre-filled for the UT Longhorns
      student queue — for most drops you can leave them as-is. (If a drop uses a different link, paste it
      into **Ticket page link**.)
   2. Click **1. Spawn New Session** → a browser window opens. **Log in** to the ticket site there.
   3. Click **2. Session Ready & Tile**.
   4. Repeat steps 2–3 to open as many parallel sessions as you want.
   5. When one clears the queue it pops to the front and turns green — **buy your ticket**, then click
      **Mark as Processed**. The next ready session takes its place automatically.

That's the whole thing. No terminal, no accounts, no setup.

---

## 🧑‍💻 For developers

Requires **Node 18+** (built on Node 22).

```bash
git clone https://github.com/AayushBaniya2006/longhorn-ticket-grabber.git
cd longhorn-ticket-grabber
npm install
npm run electron:serve      # run in dev
npm test                    # unit + component tests (32 tests)
npm run test:integration    # headless monitor/trigger check against the queue simulator
npm run test:arming         # regression: does NOT false-trigger when the queue element is absent at start
npm run test:autologin      # auto-login flow against a local fake UT site
npm run test:smoke          # launches Electron and checks the UI renders with a working bridge
npm run test:e2e            # full spawn → monitor → trigger → process against the queue simulator
npm run test:e2e-multi      # two sessions: proves only one processes at a time, next is promoted
```

**Test it against the real site (recommended before a real drop).** The tests above use local
pages, so they can't prove the selector or login still match UT's live portal. `preflight` points the
real app stack at a real URL and reports whether our assumptions hold:

```bash
npm run electron:build
npm run preflight -- "https://texaslonghorns.evenue.net/signin" --eid <YOUR_EID> --password <YOUR_PW> --watch 900
```

It opens a visible browser (you approve Duo by hand) and reports: did auto-login reach the real EID
form, is the `#hlLinkToQueueTicket2Text` selector actually present on the real waiting room, and — with
`--watch` — does it disappear when the queue clears. Credentials can also come from `UT_EID` /
`UT_PASSWORD`.

**Dev troubleshooting**
- *"Something is already running on port 3000"* (the dev server exits and takes Electron with it):
  free the port and re-run.
  ```bash
  lsof -ti:3000 | xargs kill -9    # macOS/Linux   (Windows: npx kill-port 3000)
  npm run electron:serve
  ```
- *"Spawn" fails with "Could not find Chrome":* `npx puppeteer browsers install chrome`, then retry.

Build installers yourself:

```bash
npm run package:mac         # macOS dmg/zip  ->  release/
npm run package:win         # Windows nsis   ->  release/
```

Releases are also built automatically by GitHub Actions (`.github/workflows/release.yml`) whenever a
`v*` tag is pushed.

See [docs/manual-smoke-test.md](docs/manual-smoke-test.md) for an end-to-end test using the bundled
`dummy-page/` — no live ticketing site required.

## How it works

1. **Spawn** — launches a real Puppeteer Chromium window (its own profile) pointed at the queue URL.
   No stealth/anti-detection plugin and no spoofed user agent — the window presents as the ordinary
   browser it is, and you clear any human check, log in, and check out by hand.
2. **Log in manually**, then **Session Ready** — the window is tiled and monitoring begins.
3. **Monitoring** — polls the page every 500ms with an *arm-then-trigger* rule: the waiting-room
   element (the CSS selector) must be seen **present at least once** (you've actually reached the
   queue) before its later disappearance counts as **triggered**. This is what prevents a false
   trigger while the page is still on sign-in / EID login / Duo, where the element is legitimately
   absent.
4. **Anti-bot challenge** — if the site throws a "Press & Hold" human check, the app **detects** it,
   marks the session **blocked ("Needs you: Press & Hold")**, and brings that window forward so you
   can clear it. It never solves, suppresses, or bypasses the check — clearing it is your job, by
   hand. A blocked session is not treated as a trigger.
5. **Triggered → Processing** — the first triggered session is brought to the foreground to finish
   checkout. Mark it processed and the next one is promoted.

## Architecture

```
src/
  app/App.tsx               # React control-panel UI
  backend/
    main.ts                 # Electron main: spawning, monitoring, window tiling
    preload.ts              # contextBridge -> window.api
    api-channels.ts         # typed IPC channels + payloads
    renderer-connector.ts   # main-side IPC helper
    tiling.ts               # pure window-tiling math (unit tested)
    session-queue.ts        # pure session ordering/state (unit tested)
    window-tiler.ts         # cross-platform (macOS + Windows) window placement
dummy-page/                 # local test harness
.github/workflows/          # CI: build & publish installers
```

## Credits

Originally created by **Pontus Varghav** ([@pvarghav](https://github.com/pvarghav)).
Forked, fixed up, and maintained by **Aayush Baniya** ([@AayushBaniya2006](https://github.com/AayushBaniya2006)).
