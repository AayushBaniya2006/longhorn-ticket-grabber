// Auto-login against UT's student SSO. Extracted from main.ts so it can be tested in isolation
// (no Electron imports). Best-effort: any failure just returns, leaving the page for manual login.
//
// Flow it drives: evenue landing ("Sign In as Student") -> Shibboleth -> UT EID login form
// (fill #username / #password, submit) -> Duo (the user approves manually; not automated here).
import { Page } from 'puppeteer';

export async function attemptAutoLogin(page: Page, eid: string, password: string): Promise<void> {
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
