// Auto-login against UT's student SSO. Extracted from main.ts so it can be tested in isolation
// (no Electron imports). Best-effort: any failure just returns, leaving the page for manual login.
//
// Flow it drives: evenue landing ("Sign In as Student") -> Shibboleth -> UT EID login form
// (fill #username / #password, submit) -> Duo (the user approves manually; not automated here).
import { Page } from 'puppeteer';

/**
 * True only for genuine UT single-sign-on hosts (login.utexas.edu, enterprise.login.utexas.edu, …).
 * The spawn URL is arbitrary user input, so credentials must never be typed on any other host.
 */
export function isTrustedUtLoginHost(hostname: string): boolean {
    const h = (hostname || '').toLowerCase();
    return h === 'utexas.edu' || h.endsWith('.utexas.edu');
}

export interface AutoLoginOptions {
    /**
     * Predicate deciding whether the current page's host may receive the EID + password.
     * Defaults to UT's SSO domains; the local fake-UT test overrides it to trust 127.0.0.1.
     */
    trustHost?: (hostname: string) => boolean;
}

export async function attemptAutoLogin(
    page: Page,
    eid: string,
    password: string,
    opts: AutoLoginOptions = {},
): Promise<void> {
    const trustHost = opts.trustHost ?? isTrustedUtLoginHost;
    try {
        // If we're on the evenue landing page, kick off the student SSO flow.
        const studentClicked = await page
            .evaluate(() => {
                const el = Array.from(document.querySelectorAll('a,button')).find((e) =>
                    /sign in as student/i.test(e.textContent || ''),
                );
                if (el) {
                    (el as HTMLElement).click();
                    return true;
                }
                return false;
            })
            .catch(() => false);

        if (studentClicked) {
            await page
                .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
                .catch(() => undefined);
        }

        // Wait for the UT EID login form (standard Shibboleth selectors) and fill it.
        const userSel = 'input#username, input[name="username"], input#uid';
        const passSel = 'input#password, input[name="password"]';
        const field = await page.waitForSelector(userSel, { timeout: 15000 }).catch(() => null);
        if (!field) {
            console.warn('Auto-login: UT EID login field not found; leaving the page for manual login.');
            return;
        }

        // SECURITY: only ever type the real EID + password on a trusted UT SSO host. Without this,
        // a mistyped or hostile spawn URL that happens to expose a username/password field would
        // receive the user's UT credentials.
        let host = '';
        try {
            host = new URL(page.url()).hostname;
        } catch {
            host = '';
        }
        if (!trustHost(host)) {
            console.warn(
                `Auto-login: refusing to enter credentials on untrusted host "${host}"; leaving the page for manual login.`,
            );
            return;
        }

        await page.type(userSel, eid, { delay: 30 });
        await page.type(passSel, password, { delay: 30 });

        const submitted = await page
            .evaluate(() => {
                const btn = document.querySelector(
                    'button[name="_eventId_proceed"], input[name="_eventId_proceed"], button[type="submit"], input[type="submit"], button#login-button',
                ) as HTMLElement | null;
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            })
            .catch(() => false);
        if (!submitted) await page.keyboard.press('Enter').catch(() => undefined);

        // Duo 2FA now appears — the user approves it manually. Nothing else to automate.
        console.log('Auto-login: submitted credentials; waiting for the user to approve Duo.');
    } catch (e) {
        console.warn('Auto-login failed; user can log in manually:', (e as Error).message);
    }
}
