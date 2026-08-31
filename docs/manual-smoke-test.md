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

(Any static server works; you can also point HornHub straight at the `file://` path of
`dummy-page/index.html`.)

## 2. Launch HornHub in dev

```bash
npm run electron:serve
```

> **macOS:** to let HornHub arrange the spawned browser windows, grant Accessibility permission to
> your terminal under *System Settings → Privacy & Security → Accessibility*. Without it, spawning
> and monitoring still work — you just position windows yourself, and you'll see a yellow notice.

## 3. Run the flow

1. In HornHub set **Queue URL** to `http://localhost:5055` and **Disappearing Element Selector** to
   `#box`.
2. Click **1. Spawn New Session**. A Chromium window opens on the dummy page and the session shows as
   `ACTIVE`.
3. Click **2. Session Ready & Tile**. The session flips to `MONITORING` (yellow, pulsing) and polling
   begins.
4. In the spawned Chromium window, click **"Remove me after 5 seconds"** (or **"Remove me"**).
5. Within ~0.5–5.5s the `#box` element disappears. HornHub flips the session to `TRIGGERED` (green),
   lists it under **Ready to Process**, and — since nothing else is processing — promotes it to
   `PROCESSING` in the **Processing Session** panel.
6. Click **Mark as Processed** (in the panel or the session row). The session becomes `PROCESSED` and
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
`dummy-page/queue-sim.html` mimics the evenue/Paciolan **waiting room**: it shows a "people ahead of
you" counter and contains the *real* element the app watches (`#hlLinkToQueueTicket2Text`). When the
queue clears, that element is removed — exactly what happens on the real site when you advance.

1. Serve it: `npx serve dummy-page -l 5055`
2. In the app, set **Queue URL** to `http://localhost:5055/queue-sim.html` and leave the **selector**
   at its default (`#hlLinkToQueueTicket2Text`).
3. Spawn a session → **Session Ready**. Watch the counter tick down; when it hits 0 (or click
   **Advance to the front now**), the element disappears and the app flips to `triggered → processing`.
4. Spawn several to watch parallel sessions clear at different times.

This is the closest safe stand-in for a real drop — same selector, same disappear-to-trigger behavior.

### 3. Live read-only check — the real site, without a drop
Outside of an actual ticket release you can still confirm the app talks to the real server:

1. Leave **Queue URL** at the default (`https://texaslonghorns.evenue.net/signin`).
2. Spawn a session — confirm the Chromium window opens, loads the real sign-in page, and the
   session sits in `monitoring` (it won't trigger because there's no live queue element to disappear).

This verifies spawning, navigation, and polling against the real host. **Be considerate:**
use one or two sessions, don't run it repeatedly, and only run many parallel sessions during a real
drop you're actually trying to buy in — respect the site's Terms of Service.
