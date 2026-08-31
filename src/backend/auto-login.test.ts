import { isTrustedUtLoginHost } from './auto-login';

// The spawn URL is arbitrary user input, and attemptAutoLogin types the real UT EID + password into
// the login form. This guard ensures credentials are only ever entered on a genuine UT SSO host.
describe('isTrustedUtLoginHost', () => {
  it('trusts UT SSO hosts', () => {
    expect(isTrustedUtLoginHost('utexas.edu')).toBe(true);
    expect(isTrustedUtLoginHost('login.utexas.edu')).toBe(true);
    expect(isTrustedUtLoginHost('enterprise.login.utexas.edu')).toBe(true);
  });

  it('rejects look-alike, unrelated, and local hosts', () => {
    expect(isTrustedUtLoginHost('utexas.edu.evil.com')).toBe(false);
    expect(isTrustedUtLoginHost('notutexas.edu')).toBe(false);
    expect(isTrustedUtLoginHost('texaslonghorns.evenue.net')).toBe(false);
    expect(isTrustedUtLoginHost('127.0.0.1')).toBe(false);
    expect(isTrustedUtLoginHost('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isTrustedUtLoginHost('LOGIN.UTEXAS.EDU')).toBe(true);
  });
});
