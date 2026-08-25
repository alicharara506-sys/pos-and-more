/**
 * Exponential backoff with a cap, deterministic (no jitter) so it's exactly
 * testable. attempts=1 -> baseMs, attempts=2 -> baseMs*2, etc., capped at maxMs.
 */
export function computeBackoffMs(attempts: number, baseMs = 2000, maxMs = 5 * 60_000): number {
  if (attempts < 1) return 0;
  const delay = baseMs * 2 ** (attempts - 1);
  return Math.min(delay, maxMs);
}
