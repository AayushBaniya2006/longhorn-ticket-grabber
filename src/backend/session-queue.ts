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
