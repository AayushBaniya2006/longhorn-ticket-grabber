# 🤘 Longhorn Ticket Grabber

Grab **UT Austin student football tickets** by running many queue sessions at once. When tickets
drop, the ticketing site puts everyone in a waiting-room queue. This app opens several queue
sessions in parallel and watches all of them — the moment one clears the queue, it jumps to the
front of your screen so you can buy. More sessions = better odds.

> ⚠️ **Use responsibly.** This automates *your own* browser sessions in a public queue. It does not
> bypass login, payment, or captcha — you still sign in and check out yourself. Check the ticketing
> site's Terms of Service before using it, and don't share accounts you're not allowed to.

---

## ⬇️ Download & use (no coding needed)

1. **Go to the [Releases page](https://github.com/AayushBaniya2006/longhorn-ticket-grabber/releases/latest).**
2. Download the file for your computer:
   - **Mac:** the file ending in **`.dmg`**
   - **Windows:** the file ending in **`.exe`**
3. **Open it.** Because the app isn't paid-signed yet, your computer may warn you the first time:
   - **Mac:** right-click (or Control-click) the app → **Open** → **Open** again. Then, so it can move
     the browser windows for you, allow it under *System Settings → Privacy & Security →
     **Accessibility*** when prompted.
   - **Windows:** if you see "Windows protected your PC", click **More info → Run anyway**.
4. **Use it:**
   1. The **Queue URL** and **selector** boxes are pre-filled for the UT Longhorns student queue — for
      most drops you can leave them as-is. (If a drop uses a different link, paste it into **Queue URL**.)
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
npm test                    # run the test suite (23 tests)
npm run test:integration    # headless end-to-end check against the queue simulator
```

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

1. **Spawn** — launches a stealth Puppeteer Chromium window (its own profile) pointed at the queue URL.
2. **Log in manually**, then **Session Ready** — the window is tiled and monitoring begins.
3. **Monitoring** — polls the page every 500ms; when the waiting-room element (the CSS selector)
   disappears, the session is **triggered**.
4. **Triggered → Processing** — the first triggered session is brought to the foreground to finish
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
