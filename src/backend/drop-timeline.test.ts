// Composed "full drop" spec. The individual rules (queue transition, selector arm/trigger, challenge
// detection, promotion) each have unit tests — but nothing exercises them TOGETHER over a realistic
// drop timeline, which is where their INTERACTIONS live: a Press & Hold mid-queue must not trigger, the
// selector-absent fallback must not fire while you're legitimately sitting in the Queue-it room, and a
// blank mid-redirect page must not walk a waiting session toward a false "your turn".
//
// This test drives a tiny state machine that mirrors the decision order in main.ts's 500ms poll loop
// (badPage → challenge → unblock → queue transition → selector fallback → trigger). If you change that
// order in main.ts, change it here too — this is its executable spec.

import {
    evaluateMonitorTick,
    evaluateQueueTransition,
    isChallengePage,
    selectNextToProcess,
    ChallengeSignals,
} from './session-queue';

interface TickState {
    status: 'monitoring' | 'triggered';
    armed: boolean;
    absentStreak: number;
    queueArmed: boolean;
    offQueueStreak: number;
    blocked: boolean;
}

interface Probe {
    present: boolean;
    href: string;
    challenge: ChallengeSignals;
    badPage: boolean;
}

const NO_CHALLENGE: ChallengeSignals = { title: '', bodyText: '', hasChallengeElement: false };

const initial = (): TickState => ({
    status: 'monitoring',
    armed: false,
    absentStreak: 0,
    queueArmed: false,
    offQueueStreak: 0,
    blocked: false,
});

/** One poll, in the same order as main.ts's startMonitoring interval. Mutates and returns state. */
function tick(state: TickState, probe: Probe): TickState {
    if (probe.badPage) {
        state.absentStreak = 0;
        return state;
    }
    if (isChallengePage(probe.challenge)) {
        state.absentStreak = 0;
        state.blocked = true;
        return state;
    }
    if (state.blocked) state.blocked = false;

    const queue = evaluateQueueTransition({
        href: probe.href,
        queueArmed: state.queueArmed,
        offQueueStreak: state.offQueueStreak,
    });
    state.queueArmed = queue.queueArmed;
    state.offQueueStreak = queue.offQueueStreak;

    const sel = evaluateMonitorTick({
        armed: state.armed,
        elementPresent: probe.present,
        status: state.status,
        absentStreak: state.absentStreak,
    });
    state.armed = sel.armed;
    state.absentStreak = sel.absentStreak;

    if ((queue.trigger || sel.trigger) && state.status === 'monitoring') {
        state.status = 'triggered';
    }
    return state;
}

const signIn = (): Probe => ({
    present: false,
    href: 'https://texaslonghorns.evenue.net/signin',
    challenge: NO_CHALLENGE,
    badPage: false,
});
const inQueue = (): Probe => ({
    present: false,
    href: 'https://queue.paclive.com/?c=paclive&e=texath20260902&q=tok-1',
    challenge: NO_CHALLENGE,
    badPage: false,
});
const released = (): Probe => ({
    present: false,
    href: 'https://texaslonghorns.evenue.net/signin?qitq=tok-1&qitrt=Queue&qith=abc',
    challenge: NO_CHALLENGE,
    badPage: false,
});
const pressAndHold = (): Probe => ({
    present: false,
    href: 'https://texaslonghorns.evenue.net/signin',
    challenge: { title: 'Access to this page has been denied', bodyText: 'Press & Hold to confirm you are a human', hasChallengeElement: true },
    badPage: false,
});
const blankRedirect = (): Probe => ({ present: false, href: 'about:blank', challenge: NO_CHALLENGE, badPage: true });

describe('a full Queue-it drop, tick by tick', () => {
  it('does not trigger on the sign-in page (not in the queue yet)', () => {
    const s = initial();
    for (let i = 0; i < 5; i++) tick(s, signIn());
    expect(s.status).toBe('monitoring');
    expect(s.queueArmed).toBe(false);
    expect(s.armed).toBe(false);
  });

  it('arms on the Queue-it host without triggering, then triggers on the release redirect', () => {
    const s = initial();
    tick(s, signIn());
    for (let i = 0; i < 4; i++) tick(s, inQueue());
    expect(s.queueArmed).toBe(true);
    expect(s.status).toBe('monitoring'); // still waiting in line

    // Released back to the ticketing host carrying a Queue-it token: triggers after the debounce.
    tick(s, released());
    tick(s, released());
    expect(s.status).toBe('monitoring'); // not yet — debounce not satisfied
    tick(s, released());
    expect(s.status).toBe('triggered');
  });

  it('a Press & Hold mid-queue blocks the session and never counts as a trigger', () => {
    const s = initial();
    for (let i = 0; i < 3; i++) tick(s, inQueue());
    for (let i = 0; i < 5; i++) tick(s, pressAndHold());
    expect(s.blocked).toBe(true);
    expect(s.status).toBe('monitoring');
    // Cleared by the user, back in the room: unblocks, still waiting.
    tick(s, inQueue());
    expect(s.blocked).toBe(false);
    expect(s.status).toBe('monitoring');
  });

  it('a blank mid-redirect page never walks a queued session to a false trigger', () => {
    const s = initial();
    for (let i = 0; i < 3; i++) tick(s, inQueue());
    for (let i = 0; i < 10; i++) tick(s, blankRedirect());
    expect(s.status).toBe('monitoring');
    expect(s.offQueueStreak).toBe(0);
  });

  it('promotes the triggered session for checkout', () => {
    const s = initial();
    tick(s, signIn());
    for (let i = 0; i < 3; i++) tick(s, inQueue());
    for (let i = 0; i < 3; i++) tick(s, released());
    expect(s.status).toBe('triggered');
    const next = selectNextToProcess([{ id: 'a', status: s.status }]);
    expect(next?.id).toBe('a');
  });
});

describe('a drop with no Queue-it room (selector fallback only)', () => {
  const onSite = (present: boolean): Probe => ({
    present,
    href: 'https://texaslonghorns.evenue.net/waiting',
    challenge: NO_CHALLENGE,
    badPage: false,
  });

  it('arms when the waiting-room element appears, then triggers when it disappears', () => {
    const s = initial();
    tick(s, onSite(false)); // present:false, never seen -> must not trigger
    expect(s.armed).toBe(false);
    tick(s, onSite(true)); // waiting room reached -> arm
    expect(s.armed).toBe(true);
    tick(s, onSite(false));
    tick(s, onSite(false));
    expect(s.status).toBe('monitoring'); // debounce
    tick(s, onSite(false));
    expect(s.status).toBe('triggered');
  });
});
