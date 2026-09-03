/* eslint-disable */
// Analyze a diagnostics log recorded during a real drop (the opt-in "Record this drop" checkbox).
//
//   npm run electron:build            # once, so dist/backend/diagnostics.js exists
//   npm run diagnostics:analyze -- <path-to-drop-*.jsonl>
//
// Logs live under your app-data dir, e.g. on macOS:
//   ~/Library/Application Support/Longhorn Ticket Grabber/diagnostics/drop-<ts>.jsonl
//
// It answers the one question this project can't from the couch: did N parallel sessions actually get
// INDEPENDENT queue positions (distinct tokens = real raffle tickets), or did the queue collapse them
// to one (shared token = parallelism wasted)?
const fs = require('fs');
const path = require('path');

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run diagnostics:analyze -- <path-to-drop-*.jsonl>');
    console.error('Logs are under your app-data dir: .../Longhorn Ticket Grabber/diagnostics/');
    process.exit(2);
  }

  let summarizeDiagnostics;
  try {
    ({ summarizeDiagnostics } = require(path.join(__dirname, '..', 'dist', 'backend', 'diagnostics.js')));
  } catch (e) {
    console.error('Could not load dist/backend/diagnostics.js — run `npm run electron:build` first.');
    process.exit(2);
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error('Could not read ' + file + ': ' + e.message);
    process.exit(2);
  }

  const events = [];
  raw.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      events.push(JSON.parse(t));
    } catch {
      console.warn('Skipping unparseable line ' + (i + 1));
    }
  });
  if (events.length === 0) {
    console.error('No events in log.');
    process.exit(1);
  }

  const s = summarizeDiagnostics(events);
  const spread =
    s.firstTriggerTs && s.lastTriggerTs ? Math.round((s.lastTriggerTs - s.firstTriggerTs) / 1000) : null;

  console.log('\n=== Drop diagnostics: ' + path.basename(file) + ' ===');
  console.log('Sessions spawned .............. ' + s.sessions);
  console.log('Reached the Queue-it room ..... ' + s.reachedQueue);
  console.log('Distinct queue tokens ......... ' + s.distinctTokens);
  console.log('Sessions released (your turn) . ' + s.triggered);
  if (spread !== null) console.log('First->last release spread .... ' + spread + 's');

  console.log('\n--- Did parallel sessions get INDEPENDENT positions? ---');
  if (s.reachedQueue < 2) {
    console.log('INCONCLUSIVE — fewer than 2 sessions reached the queue. Run more next time.');
  } else if (s.allTokensDistinct && s.distinctTokens === s.reachedQueue) {
    console.log('INDEPENDENT — every session that reached the queue held its OWN token. That is the');
    console.log('evidence that parallel sessions are independent raffle tickets (better odds of getting');
    console.log('IN). It does NOT mean more tickets — the per-account cap is enforced at checkout.');
  } else {
    console.log('COLLAPSED / SHARED — some sessions shared a queue token, i.e. the queue tied them to one');
    console.log('place (the operator likely enforces per-visitor uniqueness). Extra sessions did not help');
    console.log('for this drop.');
  }
  console.log('');
}

main();
