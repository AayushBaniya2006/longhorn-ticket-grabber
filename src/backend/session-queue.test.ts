import {
    selectNextToProcess,
    isProcessingInFlight,
    triggeredSessions,
    evaluateMonitorTick,
    SessionLike,
    isChallengePage,
    isQueueHost,
    evaluateQueueTransition,
    TRIGGER_ABSENT_STREAK,
    normalizeQueueProgress,
    rankByProgress,
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

describe('isChallengePage', () => {
    const base = { title: '', bodyText: '', hasChallengeElement: false };

    it('detects the PerimeterX captcha container', () => {
        expect(isChallengePage({ ...base, hasChallengeElement: true })).toBe(true);
    });

    it('detects the "Press & Hold" interstitial by body text', () => {
        expect(
            isChallengePage({
                ...base,
                bodyText: 'Before we continue... Press & Hold to confirm you are a human (and not a bot).',
            }),
        ).toBe(true);
    });

    it('detects the hard block page by title', () => {
        expect(isChallengePage({ ...base, title: 'Access to this page has been denied' })).toBe(true);
    });

    it('detects HTML-escaped "Press &amp; Hold"', () => {
        expect(isChallengePage({ ...base, bodyText: 'Press &amp; Hold to continue' })).toBe(true);
    });

    it('does not fire on an ordinary waiting-room page', () => {
        expect(
            isChallengePage({
                ...base,
                title: 'Texas Longhorns | Waiting Room',
                bodyText: "You're in the waiting room. 412 people ahead of you.",
            }),
        ).toBe(false);
    });

    it('does not fire on the sign-in page', () => {
        expect(
            isChallengePage({ ...base, title: 'Sign In', bodyText: 'UT EID Password Sign in as Student' }),
        ).toBe(false);
    });
});

describe('isQueueHost', () => {
    it('recognises the Paciolan waiting room', () => {
        expect(isQueueHost('queue.paclive.com')).toBe(true);
    });
    it('recognises Queue-it hosted rooms', () => {
        expect(isQueueHost('texas.queue-it.net')).toBe(true);
    });
    it('does not treat the ticketing site as a queue host', () => {
        expect(isQueueHost('texaslonghorns.evenue.net')).toBe(false);
    });
    it('does not treat UT SSO as a queue host', () => {
        expect(isQueueHost('login.utexas.edu')).toBe(false);
    });
});

describe('evaluateQueueTransition', () => {
    const SIGNIN = 'https://texaslonghorns.evenue.net/signin';
    const QUEUE = 'https://queue.paclive.com/afterevent.aspx?c=paclive&e=texath20250910';
    // Real shape captured from a live drop (hornhub redirect_url.txt).
    const RELEASED =
        'https://texaslonghorns.evenue.net/signin?uf=ST&ui=SHO&continue=%2Fstudents%2Fevents%2FSFC' +
        '&qitq=83d36dbd-fb02-4f43-b5e5-0edab0aad3fe&qitrt=Queue&qith=ca15fb2944be0472fa14f0c7228a5e5a';

    const start = { href: SIGNIN, queueArmed: false, offQueueStreak: 0 };

    it('does not arm or trigger on the pre-queue sign-in page', () => {
        expect(evaluateQueueTransition(start)).toEqual({
            queueArmed: false,
            offQueueStreak: 0,
            trigger: false,
        });
    });

    it('arms once the tab reaches the waiting room', () => {
        expect(evaluateQueueTransition({ ...start, href: QUEUE })).toEqual({
            queueArmed: true,
            offQueueStreak: 0,
            trigger: false,
        });
    });

    it('never triggers while still in the waiting room', () => {
        expect(
            evaluateQueueTransition({ href: QUEUE, queueArmed: true, offQueueStreak: 2 }).trigger,
        ).toBe(false);
    });

    it('triggers only after the release has held for the full streak', () => {
        let state = { href: RELEASED, queueArmed: true, offQueueStreak: 0 };
        const fired: boolean[] = [];
        for (let i = 0; i < TRIGGER_ABSENT_STREAK; i++) {
            const r = evaluateQueueTransition(state);
            fired.push(r.trigger);
            state = { ...state, queueArmed: r.queueArmed, offQueueStreak: r.offQueueStreak };
        }
        expect(fired.slice(0, -1).every((f) => f === false)).toBe(true);
        expect(fired[fired.length - 1]).toBe(true);
    });

    it('a bounce back into the waiting room resets the streak', () => {
        const partial = evaluateQueueTransition({ href: RELEASED, queueArmed: true, offQueueStreak: 0 });
        expect(partial.offQueueStreak).toBe(1);
        const back = evaluateQueueTransition({ ...partial, href: QUEUE });
        expect(back.offQueueStreak).toBe(0);
        expect(back.trigger).toBe(false);
    });

    it('decides nothing on an unparseable URL', () => {
        expect(
            evaluateQueueTransition({ href: 'about:blank', queueArmed: true, offQueueStreak: 1 }),
        ).toEqual({ queueArmed: true, offQueueStreak: 1, trigger: false });
    });
});

describe('normalizeQueueProgress', () => {
  it('passes a mid-range bar fraction through as progress', () => {
    expect(normalizeQueueProgress({ barFraction: 0.5, usersAhead: null }).progress).toBe(0.5);
  });

  it('clamps a bar fraction above 1 down to 1', () => {
    expect(normalizeQueueProgress({ barFraction: 1.4, usersAhead: null }).progress).toBe(1);
  });

  it('clamps a negative bar fraction up to 0', () => {
    expect(normalizeQueueProgress({ barFraction: -0.3, usersAhead: null }).progress).toBe(0);
  });

  it('reports unknown progress (null) when no bar was found', () => {
    expect(normalizeQueueProgress({ barFraction: null, usersAhead: 40 }).progress).toBeNull();
  });

  it('treats a NaN bar fraction as unknown', () => {
    expect(normalizeQueueProgress({ barFraction: Number.NaN, usersAhead: null }).progress).toBeNull();
  });

  it('floors a fractional users-ahead count', () => {
    expect(normalizeQueueProgress({ barFraction: null, usersAhead: 40.9 }).usersAhead).toBe(40);
  });

  it('rejects a negative users-ahead as unknown', () => {
    expect(normalizeQueueProgress({ barFraction: null, usersAhead: -5 }).usersAhead).toBeNull();
  });
});

describe('rankByProgress', () => {
  it('orders sessions closest-to-front (highest progress) first', () => {
    const ranked = rankByProgress([
      { id: 'a', progress: 0.2 },
      { id: 'b', progress: 0.9 },
      { id: 'c', progress: 0.5 },
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts sessions with unknown progress last', () => {
    const ranked = rankByProgress([
      { id: 'a', progress: null },
      { id: 'b', progress: 0.3 },
      { id: 'c', progress: null },
      { id: 'd', progress: 0.8 },
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('keeps input order for equal progress (stable)', () => {
    const ranked = rankByProgress([
      { id: 'a', progress: 0.5 },
      { id: 'b', progress: 0.5 },
      { id: 'c', progress: 0.5 },
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('ranks by fewest users-ahead when no progress bar is available (count-only pages)', () => {
    const ranked = rankByProgress([
      { id: 'a', progress: null, usersAhead: 100 },
      { id: 'b', progress: null, usersAhead: 10 },
      { id: 'c', progress: 0.5, usersAhead: 999 },
      { id: 'd', progress: null, usersAhead: null },
    ]);
    // c has a real progress fraction → front; among the rest, fewer-ahead first, unknown count last.
    expect(ranked.map((s) => s.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});
