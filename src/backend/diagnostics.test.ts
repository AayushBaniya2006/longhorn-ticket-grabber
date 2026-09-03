import { extractQueueToken, summarizeDiagnostics, DiagEvent } from './diagnostics';

describe('extractQueueToken', () => {
  it('reads the `q` token from a Queue-it waiting-room URL', () => {
    expect(
      extractQueueToken('https://queue.paclive.com/?c=paclive&e=texath20260902&q=abc-123'),
    ).toBe('abc-123');
  });

  it('reads the `q` token from the afterevent.aspx form', () => {
    expect(
      extractQueueToken('https://queue.paclive.com/afterevent.aspx?c=paclive&e=texath&q=uuid-9'),
    ).toBe('uuid-9');
  });

  it('reads the `qitq` token from the released ticketing URL', () => {
    expect(
      extractQueueToken('https://texaslonghorns.evenue.net/signin?x=1&qitq=def-456&qitrt=Queue'),
    ).toBe('def-456');
  });

  it('returns null when no queue token is present', () => {
    expect(extractQueueToken('https://queue.paclive.com/?c=paclive&e=texath')).toBeNull();
  });

  it('returns null for an unparseable URL', () => {
    expect(extractQueueToken('about:blank')).toBeNull();
  });
});

describe('summarizeDiagnostics', () => {
  it('counts sessions, queue arrivals, distinct tokens, and triggers', () => {
    const events: DiagEvent[] = [
      { ts: 1000, sessionId: 's1', event: 'spawn' },
      { ts: 1100, sessionId: 's2', event: 'spawn' },
      { ts: 2000, sessionId: 's1', event: 'queue-armed', tokenHash: 'aaa' },
      { ts: 2100, sessionId: 's2', event: 'queue-armed', tokenHash: 'bbb' },
      { ts: 3000, sessionId: 's1', event: 'triggered', tokenHash: 'aaa' },
      { ts: 3500, sessionId: 's2', event: 'triggered', tokenHash: 'bbb' },
    ];
    expect(summarizeDiagnostics(events)).toEqual({
      sessions: 2,
      reachedQueue: 2,
      distinctTokens: 2,
      allTokensDistinct: true,
      triggered: 2,
      firstTriggerTs: 3000,
      lastTriggerTs: 3500,
    });
  });

  it('flags shared tokens (evidence the queue collapsed sessions to one place)', () => {
    const events: DiagEvent[] = [
      { ts: 1, sessionId: 's1', event: 'queue-armed', tokenHash: 'same' },
      { ts: 2, sessionId: 's2', event: 'queue-armed', tokenHash: 'same' },
    ];
    const summary = summarizeDiagnostics(events);
    expect(summary.distinctTokens).toBe(1);
    expect(summary.allTokensDistinct).toBe(false);
  });

  it('reports null trigger timestamps when nothing triggered', () => {
    const events: DiagEvent[] = [
      { ts: 1, sessionId: 's1', event: 'spawn' },
      { ts: 2, sessionId: 's1', event: 'queue-armed', tokenHash: 'aaa' },
    ];
    const summary = summarizeDiagnostics(events);
    expect(summary.triggered).toBe(0);
    expect(summary.firstTriggerTs).toBeNull();
    expect(summary.lastTriggerTs).toBeNull();
  });
});
