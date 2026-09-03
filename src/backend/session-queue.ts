// Pure session-queue/state logic. No Electron/Puppeteer imports so this is unit-testable.

export type SessionStatus = 'active' | 'monitoring' | 'triggered' | 'processing' | 'processed';

/** Minimal shape needed for queue decisions. */
export interface SessionLike {
    id: string;
    status: SessionStatus;
}

/** True while a session is being processed — blocks promoting the next one. */
export function isProcessingInFlight(sessions: Iterable<SessionLike>): boolean {
    return Array.from(sessions).some((s) => s.status === 'processing');
}

/**
 * The next session to promote to "processing", or null.
 * Returns null if something is already processing; otherwise the first triggered session
 * in iteration order (Map insertion order = arrival order).
 */
export function selectNextToProcess<T extends SessionLike>(sessions: Iterable<T>): T | null {
    const arr = Array.from(sessions);
    if (arr.some((s) => s.status === 'processing')) return null;
    return arr.find((s) => s.status === 'triggered') ?? null;
}

/** Sessions currently waiting to be processed, in arrival order. */
export function triggeredSessions<T extends SessionLike>(sessions: Iterable<T>): T[] {
    return Array.from(sessions).filter((s) => s.status === 'triggered');
}

/**
 * Consecutive polls the selector must stay absent (after arming) before a disappearance is trusted
 * as "your turn". At POLL_INTERVAL_MS = 500ms this is ~1.5s — long enough that a transient blip
 * (a redirect interstitial, a network-error page, a momentary DOM swap) does not false-trigger.
 */
export const TRIGGER_ABSENT_STREAK = 3;

/** Inputs to a single monitor poll. */
export interface MonitorTickInput {
    /** Has the queue selector been observed present at least once (i.e. the waiting room was reached)? */
    armed: boolean;
    /** Is the queue selector present on the page right now? */
    elementPresent: boolean;
    /** Current session status. */
    status: SessionStatus;
    /** Consecutive polls the selector has been absent since arming (0 when last seen present). */
    absentStreak: number;
}

/** What a single monitor poll decides. */
export interface MonitorTickResult {
    /** The armed flag to persist back onto the session. */
    armed: boolean;
    /** The updated consecutive-absent count to persist back onto the session. */
    absentStreak: number;
    /** True when this poll means "the queue cleared — it's your turn". */
    trigger: boolean;
}

/**
 * Decide what a single ~500ms monitor poll means, using an ARM-THEN-TRIGGER rule with debounce.
 *
 * Arming: the queue selector must be seen present at least once (you actually reached the waiting
 * room) before its later ABSENCE counts as "your turn". Without arming, the selector is legitimately
 * absent on the sign-in / EID login / Duo screens, so the very first poll would false-trigger — which
 * is exactly what happened against the real texaslonghorns.evenue.net/signin page.
 *
 * Debounce: even after arming, the selector is momentarily absent during ordinary redirects and on a
 * transient network-error page. So a disappearance only fires once it has persisted for
 * TRIGGER_ABSENT_STREAK consecutive polls; any reappearance resets the streak.
 */
export function evaluateMonitorTick({
    armed,
    elementPresent,
    status,
    absentStreak,
}: MonitorTickInput): MonitorTickResult {
    if (elementPresent) {
        // In the waiting room: arm, clear any absent streak, and never trigger while it's showing.
        return { armed: true, absentStreak: 0, trigger: false };
    }
    if (!armed) {
        // Absent and never seen: still on sign-in / login / Duo, not in the queue yet. Keep waiting.
        return { armed: false, absentStreak: 0, trigger: false };
    }
    // Armed and now absent: count consecutive absences and only trigger once the element has stayed
    // gone long enough that it isn't a transient blip.
    const streak = absentStreak + 1;
    return {
        armed: true,
        absentStreak: streak,
        trigger: status === 'monitoring' && streak >= TRIGGER_ABSENT_STREAK,
    };
}

// --- Anti-bot challenge detection ---
//
// texaslonghorns.evenue.net sits behind PerimeterX, which interrupts with a "Press & Hold to confirm
// you are a human" interstitial (and, once it hard-blocks, an "Access to this page has been denied"
// page carrying a reference ID). A challenged session is NOT in the queue and never will be until a
// person clears it by hand, but to the monitor it just looks like "selector absent" — so without
// this the session silently burns the whole drop window looking healthy.
//
// This only DETECTS the challenge so the app can surface it and put the window in front of you.
// Nothing here solves, suppresses, or automates the challenge: the press-and-hold is the human check
// itself, and clearing it is the user's job.

/** Page signals scraped in-page, decided on in Node so the rule stays unit-testable. */
export interface ChallengeSignals {
    title: string;
    /** Leading slice of document.body.innerText — the full text is not needed and can be huge. */
    bodyText: string;
    /** A PerimeterX captcha container was found in the DOM. */
    hasChallengeElement: boolean;
}

const CHALLENGE_TEXT_RX =
    /press\s*&?(?:amp;)?\s*hold|access to this page has been denied|confirm you are a human/i;

/** True when the page is an anti-bot interstitial or block page rather than the site itself. */
export function isChallengePage({ title, bodyText, hasChallengeElement }: ChallengeSignals): boolean {
    if (hasChallengeElement) return true;
    return CHALLENGE_TEXT_RX.test(title) || CHALLENGE_TEXT_RX.test(bodyText);
}

// --- Queue-it host transition (the primary trigger) ---
//
// UT's drop fronts evenue with a Queue-it waiting room on a SEPARATE HOST. Captured from a real
// drop (upstream hornhub's redirect_url.txt, event texath20250910):
//
//   waiting room : https://queue.paclive.com/afterevent.aspx?c=paclive&e=texath20250910&q=<uuid>...
//   your turn    : https://texaslonghorns.evenue.net/signin?...&qitq=<uuid>&qitrt=Queue&qith=<hmac>
//
// So "it's your turn" is not a DOM event at all — it is a redirect off the queue host back to the
// ticketing host carrying a Queue-it token. Watching for that is far more robust than watching a CSS
// selector, which was only ever a guess inherited from upstream and breaks on any page redesign.
//
// The selector rule (evaluateMonitorTick) stays as a fallback for drops that don't use Queue-it;
// whichever fires first wins.

/** Hosts that serve a waiting room rather than the ticketing site itself. */
const QUEUE_HOST_RX = /^queue\.paclive\.com$|\.queue-it\.net$|^queue\./i;

export function isQueueHost(hostname: string): boolean {
    return QUEUE_HOST_RX.test((hostname || '').toLowerCase());
}

export interface QueueTransitionInput {
    /** document.location.href as seen by this poll. */
    href: string;
    /** Has this session been observed sitting on the queue host at least once? */
    queueArmed: boolean;
    /** Consecutive polls spent off the queue host since arming. */
    offQueueStreak: number;
}

export interface QueueTransitionResult {
    queueArmed: boolean;
    offQueueStreak: number;
    trigger: boolean;
}

/**
 * Decide whether this poll means the Queue-it waiting room has released this session.
 *
 * Arms while the tab sits on the queue host, then triggers once it has moved off that host for
 * TRIGGER_ABSENT_STREAK consecutive polls. The debounce matters because the hand-off is a chain of
 * redirects, and a mid-chain blank/error page must not read as "your turn" (callers also filter
 * error pages out before calling this).
 */
export function evaluateQueueTransition({
    href,
    queueArmed,
    offQueueStreak,
}: QueueTransitionInput): QueueTransitionResult {
    let hostname = '';
    try {
        hostname = new URL(href).hostname;
    } catch {
        // Unparseable: decide nothing this tick.
        return { queueArmed, offQueueStreak, trigger: false };
    }
    // `about:blank`, `chrome-error://...` and `data:` URLs all parse but carry no hostname. They show
    // up mid-redirect and on a failed load; counting them as "off the queue host" would walk a waiting
    // session toward a false trigger. No host means no evidence — hold the streak where it is.
    if (!hostname) return { queueArmed, offQueueStreak, trigger: false };

    if (isQueueHost(hostname)) {
        // Still waiting. Arm, and reset any partial off-host streak from a redirect blip.
        return { queueArmed: true, offQueueStreak: 0, trigger: false };
    }
    if (!queueArmed) {
        // Never reached the waiting room yet — this is the pre-queue sign-in page.
        return { queueArmed: false, offQueueStreak: 0, trigger: false };
    }
    const streak = offQueueStreak + 1;
    return { queueArmed: true, offQueueStreak: streak, trigger: streak >= TRIGGER_ABSENT_STREAK };
}

// --- Queue-it progress (the leaderboard) ---
//
// The Queue-it waiting-room page shows how far along you are — a progress bar and, when the operator
// enables it, a "users ahead of you" count. There is NO documented client API for this (confirmed
// against Queue-it's own docs), so the page probe reads whatever the DOM exposes best-effort and may
// legitimately come back with nothing; these helpers normalize that raw read and rank sessions so the
// UI can show which window is closest to the front. Ranking by progress, not selecting a winner: the
// user still buys by hand in whichever window releases first.

/** Raw progress signals scraped in-page (decided on in Node so the rules stay unit-testable). */
export interface QueueProgressSignals {
    /** Fraction 0..1 from an ARIA progressbar (valuenow/valuemax), or null if none was found. */
    barFraction: number | null;
    /** Parsed "N users ahead of you", or null if the operator doesn't show a count. */
    usersAhead: number | null;
}

export interface QueueProgress {
    /** 0..1 closeness to the front (1 = at the front), or null when the page exposes no bar. */
    progress: number | null;
    /** People ahead of this session, or null when not shown. */
    usersAhead: number | null;
}

/** Clamp a scraped progress reading into a trustworthy shape; unparseable inputs become null. */
export function normalizeQueueProgress({ barFraction, usersAhead }: QueueProgressSignals): QueueProgress {
    const progress =
        barFraction !== null && Number.isFinite(barFraction)
            ? Math.min(1, Math.max(0, barFraction))
            : null;
    const ahead =
        usersAhead !== null && Number.isFinite(usersAhead) && usersAhead >= 0 ? Math.floor(usersAhead) : null;
    return { progress, usersAhead: ahead };
}

/** Minimal shape the leaderboard sorts on. */
export interface ProgressRankable {
    progress: number | null;
    /** Optional secondary signal: people ahead. Used when the page shows a count but no bar. */
    usersAhead?: number | null;
}

/**
 * Order sessions closest-to-front first. A known progress fraction wins (higher = closer) and always
 * outranks a session with no bar. Within the same bucket — equal progress, or both with no bar — the
 * session with FEWER users ahead ranks first, so count-only pages (a "N ahead" number but no bar) still
 * sort sensibly. Sessions with neither signal keep input order, so the list doesn't jitter between polls.
 */
export function rankByProgress<T extends ProgressRankable>(sessions: Iterable<T>): T[] {
    return Array.from(sessions)
        .map((s, i) => ({ s, i }))
        .sort((a, b) => {
            const pa = a.s.progress;
            const pb = b.s.progress;
            if (pa !== null && pb !== null) {
                if (pb !== pa) return pb - pa;
            } else if (pa !== null) {
                return -1;
            } else if (pb !== null) {
                return 1;
            }
            const ua = a.s.usersAhead ?? null;
            const ub = b.s.usersAhead ?? null;
            if (ua !== null && ub !== null) {
                if (ua !== ub) return ua - ub;
            } else if (ua !== null) {
                return -1;
            } else if (ub !== null) {
                return 1;
            }
            return a.i - b.i;
        })
        .map((x) => x.s);
}
