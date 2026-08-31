// MUST be imported before puppeteer.
//
// Puppeteer reads PUPPETEER_CACHE_DIR and freezes its configuration at module-load time. If we set
// the env var after puppeteer has already been required, the assignment is a no-op: a packaged build
// then looks in ~/.cache/puppeteer (absent on end-user machines) instead of the bundled
// resources/puppeteer-cache, and every session spawn fails with "Could not find Chrome". Setting it
// in this tiny side-effect module, imported first in main.ts, guarantees it is in place in time.
//
// Gate on app.isPackaged, not isDev, so an unpackaged production run (e.g. the CI e2e) still uses
// Puppeteer's default cache.
import path from 'path';
import { app } from 'electron';

if (app.isPackaged && process.resourcesPath) {
    process.env.PUPPETEER_CACHE_DIR = path.join(process.resourcesPath, 'puppeteer-cache');
}

export {};
