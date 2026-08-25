import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '../backoff';

describe('computeBackoffMs', () => {
  it('returns 0 for zero/negative attempts', () => {
    expect(computeBackoffMs(0)).toBe(0);
    expect(computeBackoffMs(-1)).toBe(0);
  });

  it('doubles each attempt from the base', () => {
    expect(computeBackoffMs(1, 1000)).toBe(1000);
    expect(computeBackoffMs(2, 1000)).toBe(2000);
    expect(computeBackoffMs(3, 1000)).toBe(4000);
    expect(computeBackoffMs(4, 1000)).toBe(8000);
  });

  it('caps at maxMs', () => {
    expect(computeBackoffMs(10, 1000, 5000)).toBe(5000);
  });
});
