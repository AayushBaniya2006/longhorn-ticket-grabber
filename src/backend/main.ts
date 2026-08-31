import './puppeteer-cache'; // MUST be first: sets PUPPETEER_CACHE_DIR before puppeteer is loaded.
import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, safeStorage, screen } from 'electron';
import isDev from 'electron-is-dev';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

import { MainToRendererChannels, RendererToMainChannels, RequestResponseChannels } from './api-channels';
import RendererConnector from './renderer-connector';
import { computeMainSplit } from './tiling';
import { selectNextToProcess, evaluateMonitorTick } from './session-queue';
import {
    ensureAccessibilityGrant,
    minimizeWindow,
    requiresAccessibilityGrant,
    restoreWindow,
    setWindowBounds,
    tileWindows,
} from './window-tiler';
import { attemptAutoLogin } from './auto-login';

// Use the stealth plugin to make the spawned Chromium sessions look like ordinary browsers.
// (PUPPETEER_CACHE_DIR for packaged builds is set in ./puppeteer-cache, imported first above.)
puppeteer.use(StealthPlugin());

// --- Constants ---
const DEFAULT_SELECTOR = '#hlLinkToQueueTicket2Text';
const MAIN_UI_FRACTION = 0.3; // left 30% reserved for the HornHub control panel
const POLL_INTERVAL_MS = 500;

// --- Type Definitions ---
interface Session {
    id: string;
    browser: Browser;
    page: Page;
    pid: number;
    selector: string;
    status: 'active' | 'monitoring' | 'triggered' | 'processing' | 'processed';
    // True once the queue selector has been seen present at least once (waiting room reached).
    // Its disappearance only counts as a trigger after the session is armed — see evaluateMonitorTick.
    armed: boolean;
}

let mainWindow: BrowserWindow | null = null;
let rendererConnector: RendererConnector | null = null;
const sessions = new Map<string, Session>();
const monitorTimers = new Map<string, ReturnType<typeof setInterval>>();
let activeSessionId: string | null = null;

let mainScreen: Electron.Display | null = null;
let secondaryScreen: Electron.Display | null = null;

const userDataPath = app.getPath('userData');

// --- Window helpers ---
const createMainWindow = async () => {
    if (mainWindow) return;
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 1000,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // Must stay false: the preload requires local modules (./api-channels), which a
            // sandboxed preload cannot do — that would leave window.api undefined and blank the UI.
            sandbox: false,
            webviewTag: true,
        },
    });

    // Null the reference when the window is closed, so createMainWindow can recreate it (macOS: the
    // app stays alive after the control panel is closed, and clicking the dock icon must reopen it).
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    await mainWindow.loadURL(
        isDev
            ? 'http://localhost:3000'
            // Packaged layout: main.js lives in dist/backend/, the renderer in build/ at the app root.
            : `file://${path.join(__dirname, '../../build/index.html')}`,
    );

    // Reserve the left MAIN_UI_FRACTION of the primary screen for the control panel.
    if (mainScreen) {
        const { main } = computeMainSplit(mainScreen.workArea, MAIN_UI_FRACTION);
        mainWindow.setBounds(main);
    }

    // If we're reopening after a close, re-point the existing connector at the new window. IPC
    // handlers live on the global ipcMain, so they must not be re-registered.
    rendererConnector?.setWindow(mainWindow);
};

/** Place a session's browser window on the right-hand "session" pane of the primary screen. */
const placeSessionOnMain = (pid: number): boolean => {
    if (!mainScreen) return false;
    const { session } = computeMainSplit(mainScreen.workArea, MAIN_UI_FRACTION);
    return setWindowBounds(pid, session, mainScreen.scaleFactor);
};

/**
 * Tile the still-waiting session windows (active/monitoring/triggered) while monitoring. Sessions
 * that are 'processing' or 'processed' are left alone — the user may be mid-checkout on the main
 * pane, and yanking that window into the grid (or minimizing it on a single monitor) would disrupt
 * them. Uses the secondary screen if present, otherwise minimizes the windows to get them out of the
 * way. Returns how many windows were placed.
 */
const tileMonitoringSessions = (): number => {
    const pids = Array.from(sessions.values())
        .filter((s) => s.status !== 'processing' && s.status !== 'processed')
        .map((s) => s.pid);
    if (pids.length === 0) return 0;
    if (!secondaryScreen) {
        pids.forEach(minimizeWindow);
        return 0;
    }
    return tileWindows(pids, secondaryScreen.workArea, secondaryScreen.scaleFactor);
};

/**
 * Promote the next triggered session (if any) to the foreground for the user to complete. Dead
 * sessions (browser crashed or window closed) that are still queued are discarded rather than
 * promoted — otherwise a dead session would be marked 'processing' and deadlock the queue.
 */
const promoteNextSession = (): void => {
    let next = selectNextToProcess(sessions.values());
    while (next && !next.browser.isConnected()) {
        clearMonitor(next.id);
        sessions.delete(next.id);
        next = selectNextToProcess(sessions.values());
    }
    if (!next) return;

    next.status = 'processing';
    sessions.set(next.id, next);

    restoreWindow(next.pid);
    placeSessionOnMain(next.pid);

    rendererConnector?.sendToRenderer(MainToRendererChannels.SESSION_PROCESSING, { sessionId: next.id });
};

// --- Monitoring ---
const clearMonitor = (sessionId: string): void => {
    const timer = monitorTimers.get(sessionId);
    if (timer) {
        clearInterval(timer);
        monitorTimers.delete(sessionId);
    }
};

/**
 * Poll a session's page for its selector. When the element disappears (queue advanced), mark the
 * session triggered and try to promote it. Polling is more robust than a MutationObserver across
 * the page redirects that happen inside these ticketing queues.
 */
const startMonitoring = (sessionId: string): void => {
    if (!sessions.has(sessionId)) return;

    const timer = setInterval(async () => {
        const current = sessions.get(sessionId);
        if (!current || !current.browser.isConnected()) {
            clearMonitor(sessionId);
            return;
        }

        try {
            const elementPresent = await current.page.evaluate(
                (sel: string) => document.querySelector(sel) !== null,
                current.selector,
            );

            const { armed, trigger } = evaluateMonitorTick({
                armed: current.armed,
                elementPresent,
                status: current.status,
            });

            if (armed !== current.armed) {
                current.armed = armed;
                sessions.set(sessionId, current);
            }

            if (trigger) {
                clearMonitor(sessionId);
                current.status = 'triggered';
                sessions.set(sessionId, current);
                rendererConnector?.sendToRenderer(MainToRendererChannels.SESSION_TRIGGERED, { sessionId });
                promoteNextSession();
            }
        } catch (e) {
            console.warn(`Could not check element in session ${sessionId}; page may be navigating or closed.`);
            if (!current.browser.isConnected()) clearMonitor(sessionId);
        }
    }, POLL_INTERVAL_MS);

    monitorTimers.set(sessionId, timer);
};

// --- Credentials (saved locally per user, encrypted via the OS keychain) ---
const credentialsPath = () => path.join(userDataPath, 'credentials.enc');

function saveCredentials(eid: string, password: string): boolean {
    try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        const blob = safeStorage.encryptString(JSON.stringify({ eid, password }));
        fs.writeFileSync(credentialsPath(), blob);
        return true;
    } catch (e) {
        console.error('Failed to save credentials:', (e as Error).message);
        return false;
    }
}

function loadCredentials(): { eid: string; password: string } | null {
    try {
        const p = credentialsPath();
        if (!fs.existsSync(p) || !safeStorage.isEncryptionAvailable()) return null;
        const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(p)));
        return { eid: parsed.eid ?? '', password: parsed.password ?? '' };
    } catch (e) {
        console.error('Failed to load credentials:', (e as Error).message);
        return null;
    }
}

function clearCredentials(): void {
    try {
        const p = credentialsPath();
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
        console.error('Failed to clear credentials:', (e as Error).message);
    }
}

// --- Per-session browser profiles ---
// Each spawn gets its own Chromium userDataDir under userData/session-<ts>. These hold post-login UT
// SSO cookies, so they must not linger: we delete a session's profile when its browser goes away, and
// sweep any left over from a previous run (e.g. a crash) at startup.
function removeSessionProfile(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        console.warn(`Failed to remove session profile ${dir}: ${(e as Error).message}`);
    }
}

function sweepStaleSessionProfiles(): void {
    try {
        for (const name of fs.readdirSync(userDataPath)) {
            if (name.startsWith('session-')) removeSessionProfile(path.join(userDataPath, name));
        }
    } catch (e) {
        // userData may not exist yet on first run — nothing to sweep.
    }
}

// --- IPC handlers ---
const registerHandlers = (connector: RendererConnector): void => {
    connector.addRequestHandler(RequestResponseChannels.SPAWN_SESSION, async (_event, data) => {
        let browser: Browser | undefined;
        let sessionUserDataPath: string | undefined;
        try {
            const url = data.url;
            const selector = data.selector?.trim() || DEFAULT_SELECTOR;
            const eid = data.eid?.trim() || '';
            // Fall back to the stored password when the renderer doesn't send one (it no longer holds
            // the saved password in plaintext — see LOAD_CREDENTIALS).
            let password = data.password || '';
            if (!password) {
                const saved = loadCredentials();
                if (saved && saved.password && (!eid || saved.eid === eid)) password = saved.password;
            }

            const sessionId = `session-${Date.now()}`;
            sessionUserDataPath = path.join(userDataPath, sessionId);
            if (!fs.existsSync(sessionUserDataPath)) {
                fs.mkdirSync(sessionUserDataPath, { recursive: true });
            }

            browser = await puppeteer.launch({
                headless: false,
                userDataDir: sessionUserDataPath,
                defaultViewport: null,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                    '--disable-speech-api',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-client-side-phishing-detection',
                    '--disable-component-update',
                    '--disable-default-apps',
                    '--disable-dev-shm-usage',
                    '--disable-domain-reliability',
                    '--disable-extensions',
                    '--disable-features=AudioServiceOutOfProcess',
                    '--disable-hang-monitor',
                    '--disable-ipc-flooding-protection',
                    '--disable-notifications',
                    '--disable-offer-store-unmasked-wallet-cards',
                    '--disable-popup-blocking',
                    '--disable-print-preview',
                    '--disable-prompt-on-repost',
                    '--disable-renderer-backgrounding',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--no-default-browser-check',
                    '--no-first-run',
                    '--no-pings',
                    '--no-zygote',
                    '--password-store=basic',
                    '--use-gl=swiftshader',
                    '--use-mock-keychain',
                    '--window-size=1920,1080',
                ],
            });

            const pages = await browser.pages();
            const page = pages[0] || (await browser.newPage());

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
            );
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
            });

            await page.goto(url, { waitUntil: 'domcontentloaded' });

            const browserProcess = browser.process();
            if (!browserProcess || !browserProcess.pid) {
                console.error('Could not get browser process PID. Tiling will fail.');
                await browser.close();
                return { success: false, error: 'Failed to get browser process PID.' };
            }
            const pid = browserProcess.pid;

            activeSessionId = sessionId;
            sessions.set(sessionId, { id: sessionId, browser, page, pid, selector, status: 'active', armed: false });

            // Clean up if the user closes the Chromium window or it crashes: stop monitoring, drop the
            // session, wipe its (auth-cookie-bearing) profile, and let the next queued session through
            // if this one was the active/processing one — so a closed window can't deadlock the queue.
            const profileDir = sessionUserDataPath;
            browser.on('disconnected', () => {
                const dead = sessions.get(sessionId);
                clearMonitor(sessionId);
                sessions.delete(sessionId);
                if (activeSessionId === sessionId) activeSessionId = null;
                if (profileDir) removeSessionProfile(profileDir);
                if (dead && (dead.status === 'processing' || dead.status === 'triggered')) {
                    promoteNextSession();
                }
            });

            placeSessionOnMain(pid);

            // Best-effort auto-login (non-blocking). Duo 2FA is still approved by the user.
            if (eid && password) {
                void attemptAutoLogin(page, eid, password);
            }

            return { success: true, sessionId };
        } catch (error) {
            console.error('Failed to spawn session:', error);
            // Don't leave an orphaned Chromium window or a stray profile behind on failure.
            if (browser) await browser.close().catch(() => undefined);
            if (sessionUserDataPath) removeSessionProfile(sessionUserDataPath);
            return { success: false, error: (error as Error)?.message };
        }
    });

    connector.addRequestHandler(RequestResponseChannels.SESSION_READY, async (_event, data) => {
        const session = sessions.get(data.sessionId);
        if (!session) return { success: false, error: 'Active session not found.' };

        try {
            const placed = tileMonitoringSessions();

            let warning: string | undefined;
            if (placed === 0 && secondaryScreen && requiresAccessibilityGrant()) {
                warning =
                    'Could not arrange windows. On macOS, grant Accessibility permission ' +
                    '(System Settings → Privacy & Security → Accessibility) and try again.';
                console.warn(warning);
            }

            session.status = 'monitoring';
            sessions.set(session.id, session);
            activeSessionId = null;
            startMonitoring(session.id);

            return { success: true, warning };
        } catch (error) {
            console.error('Error during session ready/tiling:', error);
            return { success: false, error: (error as Error).message };
        }
    });

    connector.addRequestHandler(RequestResponseChannels.SAVE_CREDENTIALS, async (_event, data) => {
        if (!data.remember) {
            clearCredentials();
            return { success: true };
        }
        // Keep the previously-saved password when the renderer sends an empty one (the user left the
        // "saved password" placeholder untouched) — otherwise we'd wipe it on the next spawn.
        let password = data.password;
        if (!password) {
            const existing = loadCredentials();
            password = existing?.password ?? '';
        }
        const ok = saveCredentials(data.eid, password);
        return ok
            ? { success: true }
            : { success: false, error: 'Secure storage is unavailable on this device.' };
    });

    connector.addRequestHandler(RequestResponseChannels.LOAD_CREDENTIALS, async () => {
        // Never hand the decrypted password back to the renderer; only report that one is stored.
        // On spawn, the main process reads it directly (see SPAWN_SESSION).
        const creds = loadCredentials();
        return creds
            ? { eid: creds.eid, remembered: true, hasPassword: !!creds.password }
            : { eid: '', remembered: false, hasPassword: false };
    });

    connector.addListener(RendererToMainChannels.MARK_SESSION_PROCESSED, async (_event, data) => {
        const session = sessions.get(data.sessionId);
        if (!session) return;
        session.status = 'processed';
        sessions.set(session.id, session);
        minimizeWindow(session.pid);
        promoteNextSession();
    });
};

// --- App lifecycle ---
async function init() {
    // Remove any per-session browser profiles left over from a previous run (they hold auth cookies).
    sweepStaleSessionProfiles();

    // Prompt for the macOS Accessibility grant up front so window tiling can work on first use.
    ensureAccessibilityGrant();

    mainScreen = screen.getPrimaryDisplay();
    const secondary = screen.getAllDisplays().find((display) => display.id !== mainScreen!.id);
    secondaryScreen = secondary ?? null;
    if (!secondary) {
        console.warn('No secondary screen found; session windows will be minimized while monitoring.');
    }

    await createMainWindow();
    if (!mainWindow) return;

    rendererConnector = new RendererConnector(mainWindow);
    registerHandlers(rendererConnector);
}

app.whenReady().then(init);

// On quit, close every spawned browser and wipe its profile so no authenticated session lingers.
app.on('before-quit', () => {
    for (const [id, session] of sessions) {
        clearMonitor(id);
        session.browser.close().catch(() => undefined);
        removeSessionProfile(path.join(userDataPath, id));
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});
