import {
  selectNextToProcess,
  isProcessingInFlight,
  triggeredSessions,
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
