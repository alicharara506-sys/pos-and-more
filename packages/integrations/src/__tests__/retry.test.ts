import { describe, expect, it, vi } from 'vitest';
import { RetryExhaustedError, withRetry } from '../retry';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { sleep: async () => {} });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, { maxAttempts: 4, sleep: async () => {} });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RetryExhaustedError after maxAttempts consecutive failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(withRetry(fn, { maxAttempts: 3, sleep: async () => {} })).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
