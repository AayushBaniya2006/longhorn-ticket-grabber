import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, screen } from 'electron';
import isDev from 'electron-is-dev';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

import { MainToRendererChannels, RendererToMainChannels, RequestResponseChannels } from './api-channels';
import RendererConnector from './renderer-connector';
import { computeMainSplit } from './tiling';
import { selectNextToProcess } from './session-queue';
import {
    minimizeWindow,
    requiresAccessibilityGrant,
    restoreWindow,
    setWindowBounds,
    tileWindows,
} from './window-tiler';

// Use the stealth plugin to make the spawned Chromium sessions look like ordinary browsers.
puppeteer.use(StealthPlugin());

// In a packaged build, Chromium is bundled under resources/puppeteer-cache
// (see the `extraResources` entry in package.json's `build` config).
if (!isDev && process.resourcesPath) {
    process.env.PUPPETEER_CACHE_DIR = path.join(process.resourcesPath, 'puppeteer-cache');
}

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
            webviewTag: true,
        },
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
};

/** Place a session's browser window on the right-hand "session" pane of the primary screen. */
const placeSessionOnMain = (pid: number): boolean => {
    if (!mainScreen) return false;
    const { session } = computeMainSplit(mainScreen.workArea, MAIN_UI_FRACTION);
    return setWindowBounds(pid, session);
};

/**
 * Tile every session's window while monitoring. Uses the secondary screen if present, otherwise
 * minimizes the windows to get them out of the way. Returns how many windows were placed.
 */
const tileMonitoringSessions = (): number => {
    const pids = Array.from(sessions.values()).map((s) => s.pid);
    if (pids.length === 0) return 0;
    if (!secondaryScreen) {
        pids.forEach(minimizeWindow);
        return 0;
    }
    return tileWindows(pids, secondaryScreen.workArea);
};

/** Promote the next triggered session (if any) to the foreground for the user to complete. */
const promoteNextSession = (): void => {
    const next = selectNextToProcess(sessions.values());
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
            const elementExists = await current.page.evaluate(
                (sel: string) => document.querySelector(sel) !== null,
                current.selector,
            );

            if (!elementExists) {
                clearMonitor(sessionId);
                // Re-check status to avoid a double trigger.
                if (current.status === 'monitoring') {
                    current.status = 'triggered';
                    sessions.set(sessionId, current);
                    rendererConnector?.sendToRenderer(MainToRendererChannels.SESSION_TRIGGERED, { sessionId });
                    promoteNextSession();
                }
            }
        } catch (e) {
            console.warn(`Could not check element in session ${sessionId}; page may be navigating or closed.`);
            if (!current.browser.isConnected()) clearMonitor(sessionId);
        }
    }, POLL_INTERVAL_MS);

    monitorTimers.set(sessionId, timer);
};

// --- IPC handlers ---
const registerHandlers = (connector: RendererConnector): void => {
    connector.addRequestHandler(RequestResponseChannels.SPAWN_SESSION, async (_event, data) => {
        try {
            const url = data.url;
            const selector = data.selector?.trim() || DEFAULT_SELECTOR;

            const sessionId = `session-${Date.now()}`;
            const sessionUserDataPath = path.join(userDataPath, sessionId);
            if (!fs.existsSync(sessionUserDataPath)) {
                fs.mkdirSync(sessionUserDataPath, { recursive: true });
            }

            const browser = await puppeteer.launch({
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
            sessions.set(sessionId, { id: sessionId, browser, page, pid, selector, status: 'active' });

            placeSessionOnMain(pid);

            return { success: true, sessionId };
        } catch (error) {
            console.error('Failed to spawn session:', error);
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
