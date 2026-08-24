/* eslint-disable */
// Cross-platform smoke test: launch the real Electron app (production renderer) and verify the
// window actually renders — the exact thing that can't be checked from a headless dev box but can
// be on a CI runner with a display. Runs on macOS and Windows in CI.
//
// It forces production mode (ELECTRON_IS_DEV=0) so the app loads the built renderer from build/,
// then asserts: window opens, React mounts, the preload bridge (window.api) is present (this is the
// sandbox/blank-screen regression guard), the title is right, and the core controls render.

const path = require('path');
const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, ELECTRON_IS_DEV: '0', NODE_ENV: 'production' },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // Wait for React to actually paint something into #root.
    await win.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return !!root && root.children.length > 0;
      },
      null,
      { timeout: 20000 },
    );

    const r = await win.evaluate(() => ({
      title: document.title,
      hasApi: typeof window.api !== 'undefined',
      hasSpawn: !!Array.from(document.querySelectorAll('button')).find((b) =>
        /Spawn New Session/i.test(b.textContent || ''),
      ),
      hasTicketLink: !!document.querySelector('#url'),
      hasLoginFields:
        !!Array.from(document.querySelectorAll('input')).find((i) => i.placeholder === 'UT EID'),
      rootChildren: document.getElementById('root')?.children.length || 0,
    }));

    console.log('Smoke results (' + process.platform + '):', JSON.stringify(r, null, 2));

    const failures = [];
    if (r.title !== 'Longhorn Ticket Grabber') failures.push(`title="${r.title}" (expected "Longhorn Ticket Grabber")`);
    if (!r.hasApi) failures.push('window.api is undefined — preload/sandbox broken (blank-screen regression)');
    if (r.rootChildren === 0) failures.push('React root is empty — blank screen');
    if (!r.hasSpawn) failures.push('Spawn button not rendered');
    if (!r.hasTicketLink) failures.push('ticket-link input not rendered');
    if (!r.hasLoginFields) failures.push('auto-login fields not rendered');

    if (failures.length) {
      console.error('\nSMOKE TEST FAILED:\n - ' + failures.join('\n - '));
      process.exitCode = 1;
    } else {
      console.log('\nPASS: app launches and renders with a working bridge on ' + process.platform);
    }
  } catch (e) {
    console.error('\nSMOKE TEST ERROR:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
})();
