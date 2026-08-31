// MUST be imported FIRST in main.ts.
//
// Two jobs, belt-and-suspenders, because relying on the env var alone left at least one packaged
// machine still resolving the default ~/.cache/puppeteer (absent on end-user machines) and failing
// with "Could not find Chrome":
//
//   1. Side effect (runs at import time): set PUPPETEER_CACHE_DIR to the bundled cache before
//      puppeteer is required, so puppeteer's own resolver points at resources/puppeteer-cache.
//   2. resolveBundledChromeExecutable(): find the real Chrome binary on disk by scanning the bundle,
//      so main.ts can pass `executablePath` explicitly to puppeteer.launch(). This does NOT depend on
//      env-var timing or on puppeteer agreeing about app.isPackaged — if the binary is there, we find
//      it and hand puppeteer the absolute path.
//
// Gate on app.isPackaged: an unpackaged run (dev, CI e2e) returns undefined and puppeteer uses its
// own default cache, exactly as before.
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

function bundledCacheDir(): string | null {
    if (app.isPackaged && process.resourcesPath) {
        return path.join(process.resourcesPath, 'puppeteer-cache');
    }
    return null;
}

// Side effect: point puppeteer's own config resolution at the bundled cache in packaged builds.
const cacheDir = bundledCacheDir();
if (cacheDir) {
    process.env.PUPPETEER_CACHE_DIR = cacheDir;
}

// The Chrome executable path relative to a `<cacheDir>/chrome/<platform>-<buildId>` install dir.
// Ordered by the running process's architecture: on Apple Silicon prefer the arm64 build (x64 only
// runs under Rosetta); on Intel the arm64 build will NOT run, so x64 must win.
function chromeBinaryUnder(installDir: string): string | null {
    let candidates: string[];
    if (process.platform === 'darwin') {
        const arm = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
        const x64 = 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
        candidates = process.arch === 'arm64' ? [arm, x64] : [x64, arm];
    } else if (process.platform === 'win32') {
        candidates = ['chrome-win64/chrome.exe', 'chrome-win32/chrome.exe'];
    } else {
        candidates = ['chrome-linux64/chrome', 'chrome-linux/chrome'];
    }
    for (const rel of candidates) {
        const p = path.join(installDir, rel);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// Find the actual bundled Chrome binary by scanning the cache. Robust to the exact buildId string, so
// a puppeteer bump that changes the Chrome version can't silently break resolution. Returns undefined
// (not null) so it drops cleanly into puppeteer.launch() opts. Dev/unpackaged -> undefined -> default.
export function resolveBundledChromeExecutable(): string | undefined {
    try {
        const dir = bundledCacheDir();
        if (!dir) return undefined;
        const chromeRoot = path.join(dir, 'chrome');
        if (!fs.existsSync(chromeRoot)) return undefined;
        for (const entry of fs.readdirSync(chromeRoot)) {
            const bin = chromeBinaryUnder(path.join(chromeRoot, entry));
            if (bin) return bin;
        }
        return undefined;
    } catch {
        return undefined;
    }
}
