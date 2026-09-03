# Changelog

Which version should I use? If you just want the app to work, use the latest **release** (installer on
the Releases page). If a newer build ever misbehaves, **v0.3.1 is the known-good fallback** — it's kept
on the repo as the `v0.3.1-stable` branch and the `v0.3.1` release, and it worked (see below).

## v0.4.0 — Alerts, queue leaderboard, and diagnostics (current, on `main`)

All built on the existing spawn → monitor → trigger → tile spine; nothing about the bot check changed
(the app still only *detects* "Press & Hold" and hands it to you).

- **Never miss a clear.** When a session clears the queue or hits a "Press & Hold," the app now fires a
  native notification, **bounces the Dock until you come back**, flashes the window, shows a **"GO NOW"**
  banner with a live *elapsed* timer, and flashes the window title. Visual only — no sound. This fixes
  the real failure mode from the first live drop: it's easy to tab away and miss the short entry window.
  (No fake countdown: the entry window is set by the ticket operator and is undocumented, so a fixed
  countdown would be a lie.)
- **Queue leaderboard.** A **"Closest to the front"** panel reads each session's own Queue-it progress
  (progress bar / "N users ahead") and ranks them, so many windows become one legible dashboard. The
  scraper is best-effort by design (Queue-it exposes no stable API) and degrades to "waiting…" rather
  than ever breaking monitoring.
- **Diagnostics ("Record this drop").** An opt-in checkbox in Advanced settings logs each session's
  **hashed** queue token, progress, and timings locally — no credentials, no raw tokens. Afterwards,
  `npm run diagnostics:analyze -- <log>` reports whether your parallel sessions held **independent**
  queue positions: the actual evidence for whether running several sessions helps.
- **Honest odds, documented.** The README's odds section is rewritten from researched Queue-it
  mechanics: the pre-queue is a **random raffle**, so N sessions ≈ N raffle tickets for *getting in* —
  but **not** more tickets (the per-account cap is enforced at checkout), and it's neutralized if the
  operator enforces per-visitor uniqueness.
- Also lands the previously-pending **challenge detection** ("Needs you: Press & Hold") and the
  **Queue-it host-transition trigger** (release = a redirect off the queue host, far more robust than
  watching a CSS selector).

Tests: **81** unit/component tests plus the headless integration suite (`test:integration`,
`test:arming`, `test:autologin`), all green; clean production build. The alert UI and leaderboard are
unit-tested and typechecked but still want a GUI smoke (`npm run electron:serve`) and a full live-drop
capture — see `docs/manual-smoke-test.md`.

## v0.3.1 — Bundled-Chrome fix (previous stable — tag `v0.3.1`, branch `v0.3.1-stable`)

**This version worked.** It ran end-to-end against the real UT queue in the 2026-09-02 drop capture:
spawn → real Queue-it waiting room → several parallel sessions monitored side by side. Its headline fix
was **bundling Chrome for Testing** so the packaged app finds a browser on any Mac (killing the
"Could not find Chrome" crash), resolving the executable explicitly, versioning the installer
filenames, and adding a startup-error dialog.

It does **not** include the alerts, leaderboard, or diagnostics above. Keep it as the fallback: check
out the `v0.3.1-stable` branch, or download the `v0.3.1` release.

## Earlier

- **v0.3.0** — bundle Chromium so the packaged app finds Chrome.
- **v0.2.0 / v0.1.0** — earlier builds.

> On bot detection: **no version bypasses** the site's "Press & Hold" human check — the app detects it
> and hands it to you. The upstream stealth plugin + user-agent spoofing were deliberately removed and
> will not return.
