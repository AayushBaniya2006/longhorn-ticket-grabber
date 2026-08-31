import {
  selectNextToProcess,
  isProcessingInFlight,
  triggeredSessions,
  evaluateMonitorTick,
  SessionLike,
} from './session-queue';

const s = (id: string, status: SessionLike['status']): SessionLike => ({ id, status });

describe('selectNextToProcess', () => {
  it('returns null when nothing is triggered', () => {
    expect(selectNextToProcess([s('a', 'monitoring'), s('b', 'active')])).toBeNull();
  });

  it('returns null while a session is already processing', () => {
    expect(selectNextToProcess([s('a', 'processing'), s('b', 'triggered')])).toBeNull();
  });

  it('returns the first triggered session in arrival order', () => {
    const next = selectNextToProcess([
      s('a', 'monitoring'),
      s('b', 'triggered'),
      s('c', 'triggered'),
    ]);
    expect(next?.id).toBe('b');
  });
});

describe('isProcessingInFlight', () => {
  it('detects an in-flight processing session', () => {
    expect(isProcessingInFlight([s('a', 'processing'), s('b', 'triggered')])).toBe(true);
  });

  it('is false when none are processing', () => {
    expect(isProcessingInFlight([s('a', 'triggered'), s('b', 'monitoring')])).toBe(false);
  });
});

describe('triggeredSessions', () => {
  it('lists only triggered sessions, in order', () => {
    const list = triggeredSessions([
      s('a', 'triggered'),
      s('b', 'monitoring'),
      s('c', 'triggered'),
    ]);
    expect(list.map((x) => x.id)).toEqual(['a', 'c']);
  });
});

describe('evaluateMonitorTick (arm-then-trigger)', () => {
  // Regression guard for the real-site false-trigger: on texaslonghorns.evenue.net/signin the queue
  // selector is absent (you're not in the queue yet), so the naive "selector absent = your turn" rule
  // fired PROCESSING the instant monitoring started. Arming requires the selector to be seen once.
  it('does NOT trigger while the selector is absent and was never seen (sign-in / EID / Duo screen)', () => {
    expect(evaluateMonitorTick({ armed: false, elementPresent: false, status: 'monitoring' })).toEqual({
      armed: false,
      trigger: false,
    });
  });

  it('arms without triggering once the selector appears (waiting room reached)', () => {
    expect(evaluateMonitorTick({ armed: false, elementPresent: true, status: 'monitoring' })).toEqual({
      armed: true,
      trigger: false,
    });
  });

  it('stays armed and does not trigger while the selector is still present', () => {
    expect(evaluateMonitorTick({ armed: true, elementPresent: true, status: 'monitoring' })).toEqual({
      armed: true,
      trigger: false,
    });
  });

  it('triggers only after the selector was seen and then disappears', () => {
    expect(evaluateMonitorTick({ armed: true, elementPresent: false, status: 'monitoring' })).toEqual({
      armed: true,
      trigger: true,
    });
  });

  it('does not re-trigger once the session has already left monitoring', () => {
    expect(evaluateMonitorTick({ armed: true, elementPresent: false, status: 'triggered' })).toEqual({
      armed: true,
      trigger: false,
    });
  });
});
