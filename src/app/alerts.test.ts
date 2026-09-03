import { formatElapsed } from './alerts';

describe('formatElapsed', () => {
  it('formats zero as 0:00', () => {
    expect(formatElapsed(0)).toBe('0:00');
  });

  it('zero-pads seconds under ten', () => {
    expect(formatElapsed(5)).toBe('0:05');
  });

  it('formats seconds under a minute', () => {
    expect(formatElapsed(42)).toBe('0:42');
  });

  it('rolls into minutes with zero-padded seconds', () => {
    expect(formatElapsed(65)).toBe('1:05');
  });

  it('formats double-digit minutes', () => {
    expect(formatElapsed(600)).toBe('10:00');
  });

  it('floors fractional seconds rather than showing decimals', () => {
    expect(formatElapsed(12.9)).toBe('0:12');
  });

  it('never shows a negative time (clock skew / bad input guards to 0:00)', () => {
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('guards NaN to 0:00', () => {
    expect(formatElapsed(Number.NaN)).toBe('0:00');
  });
});
