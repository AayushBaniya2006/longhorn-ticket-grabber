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
