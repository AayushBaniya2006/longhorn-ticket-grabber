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

describe('evaluateMonitorTick (arm-then-trigger, debounced)', () => {
  // Regression guard for the real-site false-trigger: on texaslonghorns.evenue.net/signin the queue
  // selector is absent (you're not in the queue yet), so the naive "selector absent = your turn" rule
  // fired PROCESSING the instant monitoring started. Arming requires the selector to be seen once.
  it('does NOT trigger while the selector is absent and was never seen (sign-in / EID / Duo screen)', () => {
    expect(
      evaluateMonitorTick({ armed: false, elementPresent: false, status: 'monitoring', absentStreak: 0 }),
    ).toEqual({ armed: false, absentStreak: 0, trigger: false });
  });

  it('arms without triggering once the selector appears (waiting room reached)', () => {
    expect(
      evaluateMonitorTick({ armed: false, elementPresent: true, status: 'monitoring', absentStreak: 0 }),
    ).toEqual({ armed: true, absentStreak: 0, trigger: false });
  });

  it('resets the absent streak whenever the selector reappears', () => {
    expect(
      evaluateMonitorTick({ armed: true, elementPresent: true, status: 'monitoring', absentStreak: 2 }),
    ).toEqual({ armed: true, absentStreak: 0, trigger: false });
  });

  it('does NOT trigger on a brief disappearance below the streak threshold (transient blip)', () => {
    expect(
      evaluateMonitorTick({ armed: true, elementPresent: false, status: 'monitoring', absentStreak: 0 }),
    ).toEqual({ armed: true, absentStreak: 1, trigger: false });
    expect(
      evaluateMonitorTick({ armed: true, elementPresent: false, status: 'monitoring', absentStreak: 1 }),
    ).toEqual({ armed: true, absentStreak: 2, trigger: false });
  });

  it('triggers only after the selector stays gone for TRIGGER_ABSENT_STREAK consecutive polls', () => {
    expect(
      evaluateMonitorTick({ armed: true, elementPresent: false, status: 'monitoring', absentStreak: 2 }),
    ).toEqual({ armed: true, absentStreak: 3, trigger: true });
  });

  it('does not re-trigger once the session has already left monitoring', () => {
    expect(
      evaluateMonitorTick({ armed: true, elementPresent: false, status: 'triggered', absentStreak: 5 }),
    ).toEqual({ armed: true, absentStreak: 6, trigger: false });
  });
});
