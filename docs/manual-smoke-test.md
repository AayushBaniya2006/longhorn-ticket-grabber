# Manual smoke test

The automated suite (`npm test`) covers the pure logic (tiling math, queue ordering) and the React
UI wiring. This checklist covers the parts that can only be verified live: Electron + Puppeteer
spawning a real browser and the monitor → trigger → process flow.

No live ticketing site is needed — the bundled `dummy-page/` provides an element you can remove on
demand to simulate the queue advancing.

## 1. Serve the dummy page

From the repo root:

```bash
npx serve dummy-page -l 5055
# -> http://localhost:5055
```

(Any static server works; you can also point Longhorn Ticket Grabber straight at the `file://` path of
`dummy-page/index.html`.)

## 2. Launch Longhorn Ticket Grabber in dev

```bash
npm run electron:serve
```

> **macOS:** to let Longhorn Ticket Grabber arrange the spawned browser windows, grant Accessibility permission to
> your terminal under *System Settings → Privacy & Security → Accessibility*. Without it, spawning
> and monitoring still work — you just position windows yourself, and you'll see a yellow notice.

## 3. Run the flow

1. In Longhorn Ticket Grabber set **Ticket page link** to `http://localhost:5055` and **Queue element
   to watch (CSS selector)** to `#box`.
2. Click **1. Spawn New Session**. A Chromium window opens on the dummy page and the session shows as
   `ACTIVE`.
3. Click **2. Session Ready & Tile**. The session flips to `MONITORING` (yellow, pulsing) and polling
   begins.
4. In the spawned Chromium window, click **"Remove me after 5 seconds"** (or **"Remove me"**).
5. Within ~0.5–5.5s the `#box` element disappears. Longhorn Ticket Grabber flips the session to `TRIGGERED` (green),
   lists it under **Ready to Process**, and — since nothing else is processing — promotes it to
   `PROCESSING` in the **Processing Session** panel.
6. **Never-miss-a-clear alert fires** at the same moment: a native macOS **notification** ("A session
   cleared — buy now!"), the **Dock icon bounces** (and keeps bouncing until you click back into the
   app), the window **title flashes** "⚠️ ACTION NEEDED", and a green **"GO NOW — a session cleared!"**
   banner appears at the top with a live **"cleared 0:0X ago"** timer and an **"I'm on it"** button that
   hides the banner (the session stays in Ready/Processing). No sound plays — that is by design.
7. Click **Mark as Processed** (in the panel or the session row). The session becomes `PROCESSED` and
   its window is minimized.

## 4. Multi-session check

Spawn several sessions (spawn → ready → spawn → ready …) before removing any elements. Then remove
elements in different windows and confirm:

- Each triggered session appears in **Ready to Process** in arrival order.
- Only **one** session is promoted to `PROCESSING` at a time.
- Marking the current one processed promotes the next triggered session automatically.

## Expected status transitions

| Step | Status |
| --- | --- |
| Spawn | `active` |
| Session Ready | `monitoring` |
| Target element disappears | `triggered` → `processing` (if nothing else processing) |
| Mark Processed | `processed` (next triggered session promoted) |

---

## Testing against something *like* the UT Austin servers

You can't (and shouldn't) hammer the real ticketing queue to test. Here are three levels, safest first.

### 1. Automated core test — no browser interaction needed
```bash
npm run test:integration
```
This drives a real headless Puppeteer browser (the same plain puppeteer stack the app uses) against the
bundled **queue simulator** and polls the target selector exactly like `main.ts` does. It advances
past the queue and asserts the app would fire `SESSION_TRIGGERED`. Fast, deterministic, CI-friendly.

### 2. Realistic manual test — the queue simulator
`dummy-page/queue-sim.html` is styled to look like the real Queue-it **"Texas Athletics Tickets
Central"** waiting room (Longhorn mark, the same student/non-student copy, a green progress bar with a
walking figure, a live "Status last updated" clock, and a Queue ID). It exposes its progress through a
real ARIA progress bar and contains the *element the app watches* (`#hlLinkToQueueTicket2Text`); when
the queue clears, that element is removed — exactly what happens on the real site when you advance. A
clear "LOCAL SIMULATION" banner keeps it from being mistaken for the real site.

1. Serve it: `npx serve dummy-page -l 5055`
2. In the app, set **Ticket page link** to `http://localhost:5055/queue-sim.html` and leave the
   **Queue element to watch** field at its default (`#hlLinkToQueueTicket2Text`).
   (Add `?preMs=135000` for the pre-queue "NN Minutes NN Seconds" countdown, or `?advanceMs=8000` to
   auto-release after 8s.)
3. Spawn a session → **Session Ready**. Watch the progress bar fill; when it reaches the front (or
   click **Advance to the front now**), the element disappears and the app flips to
   `triggered → processing`.
4. Spawn several to watch parallel sessions clear at different times.
5. While sessions are monitoring, the **"Closest to the front"** leaderboard ranks them by the queue
   page's own progress — for this simulator that's the **progress bar percentage** (higher ranks
   higher); a page that exposes no progress shows **"waiting…"**.

This is the closest safe stand-in for a real drop — same selector, same disappear-to-trigger behavior.

### 3. Live read-only check — the real site, without a drop
Outside of an actual ticket release you can still confirm the app talks to the real server:

1. Leave **Ticket page link** at the default (`https://texaslonghorns.evenue.net/signin`).
2. Spawn a session — confirm the Chromium window opens and loads the real sign-in page.

**Expect a bot check.** The real site is behind PerimeterX / HUMAN Security, so an automated browser
will usually be met with a **"Press & Hold to confirm you are a human"** challenge (an *"Access to
this page has been denied"* page with a reference ID). This is normal and expected — it is **not** a
bug in the app. The app **detects** the challenge, marks the session **blocked** and lists it under
**"Needs you: Press & Hold"**, and brings the window forward so you can clear it by hand. The same
never-miss alert fires (a **notification** + **Dock bounce**), and the red **"Needs you: Press & Hold"**
banner **pulses** and shows a **"waiting M:SS"** timer for each blocked session. The app does
**not** solve or bypass the challenge, and it won't proceed past it until a human does. Clearing it
here without a live drop just lands you back on the sign-in page (there's no queue element to watch).

This verifies spawning, navigation, challenge detection, and polling against the real host. **Be
considerate:** use one or two sessions, don't run it repeatedly, and don't try to defeat the human
check — respect the site's Terms of Service.

---

## Capture a full real run (the one thing local tests can't prove)

Everything above uses local pages, so the back half of a real drop — the Queue-it **release redirect**
firing the trigger, **auto-login + Duo**, a checkout-time **Press & Hold**, and the actual **purchase** —
has still never run end to end against the live site. The composed decision logic is now covered by
`src/backend/drop-timeline.test.ts`, and the live monitor loop by `npm run test:e2e`, but the real
site's behaviour can only be confirmed during an actual drop. So, at the next real drop:

1. Before spawning, open **Advanced settings** and tick **"Record this drop (diagnostics)."**
2. Spawn your sessions and let it run **all the way through** — keep any screen recording going until at
   least one session reaches the front (don't stop at "still in queue," like the first capture did).
3. Note whether: the released window **triggers** and pops to the front (Queue-it host-transition rule),
   auto-login reaches the EID form, Duo prompts, a **Press & Hold** appears at checkout (and the app
   flags it), and checkout completes.
4. Afterwards, run `npm run diagnostics:analyze -- <the drop-*.jsonl under your app-data dir>` to see
   whether your parallel sessions held **independent** queue positions (see README limit #2).

That single full capture is what finally closes the loop on "does the whole thing work on the real
site," and the diagnostics answer "did running several sessions actually help."
