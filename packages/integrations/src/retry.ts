/**
 * Shared retry-with-backoff for connector HTTP calls — every connector uses
 * this instead of hand-rolling its own, so rate-limit/5xx handling is
 * consistent across providers (spec §13.4).
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injectable for tests — defaults to real setTimeout-based delay. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(
      `Retry exhausted after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

/** True for a 429 (rate limit) or 5xx — the class of HTTP failure worth retrying. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw new RetryExhaustedError(maxAttempts, lastError);
}
