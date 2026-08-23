# HornHub

A desktop app that spawns and monitors **parallel queue sessions** to improve your odds of
getting University of Texas **Longhorn student tickets** on the evenue/paciolan queue system.

Each session is an isolated, stealth-configured Chromium browser (via Puppeteer) with its own
profile, so you can log in to several queue sessions at once. HornHub watches each session for the
moment it advances past the waiting room, then surfaces the "winning" session so you can complete
the purchase by hand.

> ⚠️ **Use responsibly.** This tool automates *your own* browser sessions against a ticketing queue.
> Check the ticketing site's Terms of Service before use. It does not bypass payment, captcha, or
> authentication — a human still logs in and completes each purchase.

## How it works

1. **Spawn a session** — launches a stealth Puppeteer Chromium window pointed at the queue URL,
   with its own persistent profile under Electron's `userData` directory.
2. **Log in manually** in that window, then click **Session Ready** — HornHub tiles the window and
   starts monitoring.
3. **Monitoring** — HornHub polls the page every 500ms for a target CSS selector. When that element
   *disappears* (i.e. the waiting-room/queue element is gone), the session is **triggered**.
4. **Triggered → Processing** — the first triggered session is promoted to the foreground so you can
   finish the checkout. Mark it **Processed** and the next triggered session takes its place.

Repeat spawn/login to run many sessions in parallel; whichever clears the queue first wins.

## Architecture

```
src/
  app/            # React renderer (the control-panel UI)
    App.tsx
  backend/        # Electron main process + IPC bridge
    main.ts               # app lifecycle, session spawning, monitoring, window tiling
    preload.ts            # contextBridge -> window.api
    api-channels.ts       # typed IPC channel + payload definitions
    renderer-connector.ts # main-side IPC helper
    tiling.ts             # pure window-tiling math (unit tested)
    session-queue.ts      # pure session-ordering/state logic (unit tested)
    window-tiler.ts       # cross-platform window placement (macOS + Windows)
  types/
    bridge.d.ts   # augments window.api types for the renderer
dummy-page/       # local test harness (a page whose element can be removed on demand)
```

- **Renderer** is a Create React App + Tailwind UI.
- **Main process** is compiled separately with `tsconfig.electron.json` into `dist/`.
- IPC is fully typed end-to-end through `api-channels.ts`.

## Prerequisites

- **Node 18+** (developed on Node 22)
- macOS or Windows
- On **macOS**, automatic window tiling needs **Accessibility permission**: grant it under
  *System Settings → Privacy & Security → Accessibility* for your terminal (in dev) or the packaged
  HornHub app. Without it, sessions still spawn and monitor — you just position windows yourself.

## Setup

```bash
npm install
```

## Run (development)

```bash
npm run electron:serve
```

This starts the CRA dev server, compiles the Electron main process, waits for the dev server, and
launches Electron pointed at it.

## Test

```bash
npm test              # watch mode
npm test -- --watchAll=false   # single run (CI)
```

See [docs/manual-smoke-test.md](docs/manual-smoke-test.md) for an end-to-end check using the bundled
`dummy-page/` (no live ticketing site required).

## Package a distributable

```bash
npm run package        # current OS
npm run package:mac    # macOS dmg/zip
npm run package:win    # Windows nsis installer
```

Output is written to `release/`.

## Available scripts

| Script | What it does |
| --- | --- |
| `npm start` | CRA dev server only (renderer) |
| `npm run build` | Production build of the renderer into `build/` |
| `npm run electron:build` | Compile the Electron main process into `dist/` |
| `npm run electron:serve` | Full dev experience (renderer + electron) |
| `npm test` | Jest test runner |
| `npm run package[:mac\|:win]` | Build a distributable with electron-builder |

## Credits

Originally created by **Pontus Varghav** ([@pvarghav](https://github.com/pvarghav)).
Forked, fixed up, and maintained by **Aayush Baniya** ([@AayushBaniya2006](https://github.com/AayushBaniya2006)).
