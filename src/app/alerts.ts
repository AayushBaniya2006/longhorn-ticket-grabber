// Small pure helpers for the "never miss a clear" alerts. Kept separate from App.tsx so the
// formatting is unit-testable without rendering React.

/**
 * Format an elapsed duration (in seconds) as "M:SS" for the urgency timer shown when a session
 * clears the queue or hits a Press & Hold. We show time ELAPSED, not a countdown: Queue-it's entry
 * window after "your turn" is set by the ticket operator and is undocumented for this site, so a
 * fixed countdown would be a guess. Negative / NaN inputs (clock skew, a missing timestamp) clamp
 * to 0:00 rather than rendering garbage.
 */
export function formatElapsed(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
