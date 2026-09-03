// Pure diagnostics logic. No Electron/Puppeteer/fs imports so it stays unit-testable; the main
// process does the actual file writing and token hashing and calls these to shape the data.
//
// Why this exists: the one question this whole project can't answer from the couch is "does running N
// parallel sessions actually help?" Queue-it pre-queues assign a RANDOM position per session at open,
// so N independent sessions plausibly act as N raffle tickets — but only if the operator hasn't turned
// on per-visitor uniqueness (which would collapse them to one token). Recording each session's Queue-it
// token + progress + trigger timing during a real drop turns that from a guess into evidence: distinct
// tokens = independent draws; a shared token = the queue collapsed them.

export type DiagEventKind =
    | 'spawn'
    | 'queue-armed'
    | 'progress'
    | 'triggered'
    | 'blocked'
    | 'unblocked'
    | 'processed';

export interface DiagEvent {
    /** epoch ms */
    ts: number;
    sessionId: string;
    event: DiagEventKind;
    /** SHA-256 (truncated) of the Queue-it token, so distinctness is provable without storing the raw token. */
    tokenHash?: string | null;
    host?: string | null;
    progress?: number | null;
    usersAhead?: number | null;
}

/**
 * Extract the Queue-it token from a URL: the `q` param on the waiting-room host (queue.paclive.com)
 * or the `qitq` param on the released ticketing URL. Returns null if neither is present or the URL is
 * unparseable. This token is what identifies a session's place in line — distinct tokens across
 * sessions are the evidence that parallel sessions held independent positions.
 */
export function extractQueueToken(url: string): string | null {
    try {
        const params = new URL(url).searchParams;
        return params.get('q') || params.get('qitq') || null;
    } catch {
        return null;
    }
}

export interface DiagSummary {
    /** Distinct sessions seen in the log. */
    sessions: number;
    /** Sessions that actually reached the Queue-it waiting room. */
    reachedQueue: number;
    /** Distinct per-session Queue-it tokens. */
    distinctTokens: number;
    /** True when every token-bearing session had its own unique token (independent positions). */
    allTokensDistinct: boolean;
    /** Sessions that were released ("your turn"). */
    triggered: number;
    firstTriggerTs: number | null;
    lastTriggerTs: number | null;
}

/** Roll a recorded drop's events up into the headline numbers that answer "did parallelism help?". */
export function summarizeDiagnostics(events: DiagEvent[]): DiagSummary {
    const sessionIds = new Set<string>();
    const reached = new Set<string>();
    const triggeredSet = new Set<string>();
    const tokenBySession = new Map<string, string>(); // first token observed per session
    let firstTriggerTs: number | null = null;
    let lastTriggerTs: number | null = null;

    for (const e of events) {
        sessionIds.add(e.sessionId);
        if (e.event === 'queue-armed') reached.add(e.sessionId);
        if (e.tokenHash && !tokenBySession.has(e.sessionId)) tokenBySession.set(e.sessionId, e.tokenHash);
        if (e.event === 'triggered') {
            triggeredSet.add(e.sessionId);
            firstTriggerTs = firstTriggerTs === null ? e.ts : Math.min(firstTriggerTs, e.ts);
            lastTriggerTs = lastTriggerTs === null ? e.ts : Math.max(lastTriggerTs, e.ts);
        }
    }

    const tokenedSessions = tokenBySession.size;
    const distinctTokens = new Set(tokenBySession.values()).size;
    return {
        sessions: sessionIds.size,
        reachedQueue: reached.size,
        distinctTokens,
        allTokensDistinct: distinctTokens === tokenedSessions,
        triggered: triggeredSet.size,
        firstTriggerTs,
        lastTriggerTs,
    };
}
