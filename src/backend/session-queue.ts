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

/** Inputs to a single monitor poll. */
export interface MonitorTickInput {
    /** Has the queue selector been observed present at least once (i.e. the waiting room was reached)? */
    armed: boolean;
    /** Is the queue selector present on the page right now? */
    elementPresent: boolean;
    /** Current session status. */
    status: SessionStatus;
}

/** What a single monitor poll decides. */
export interface MonitorTickResult {
    /** The armed flag to persist back onto the session. */
    armed: boolean;
    /** True when this poll means "the queue cleared — it's your turn". */
    trigger: boolean;
}

/**
 * Decide what a single ~500ms monitor poll means, using an ARM-THEN-TRIGGER rule.
 *
 * The queue selector must be seen present at least once (you actually reached the waiting room)
 * before its later ABSENCE counts as "your turn". Without arming, the selector is legitimately
 * absent on the sign-in / EID login / Duo screens, so the very first poll would treat that as
 * "queue cleared" and false-trigger immediately — which is exactly what happened against the real
 * texaslonghorns.evenue.net/signin page.
 */
export function evaluateMonitorTick({ armed, elementPresent, status }: MonitorTickInput): MonitorTickResult {
    if (elementPresent) {
        // In the waiting room: arm the session, and never trigger while the element is still showing.
        return { armed: true, trigger: false };
    }
    if (!armed) {
        // Absent and never seen: still on sign-in / login / Duo, not in the queue yet. Keep waiting.
        return { armed: false, trigger: false };
    }
    // Was in the waiting room, and the element has now disappeared: the queue advanced.
    return { armed: true, trigger: status === 'monitoring' };
}
