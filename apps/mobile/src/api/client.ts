import { loadSessionToken } from '../auth/session-store';

// Expo exposes env vars prefixed EXPO_PUBLIC_ to app code (the RN equivalent
// of Next.js's NEXT_PUBLIC_ convention) — see apps/mobile's own .env.example note in README.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  tenantId?: string | null;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the stored session token — mainly for login itself, before a token exists. */
  token?: string | null;
}

/**
 * Bearer-token API client for React Native. Unlike apps/web, there is no
 * reliable automatic cookie jar in RN's fetch, so auth uses the
 * `sessionToken` the API also returns in the login response body (see
 * apps/api/src/auth/auth.controller.ts's respondWithSession) rather than
 * `credentials: 'include'`.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const token = options.token !== undefined ? options.token : await loadSessionToken();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    // A thrown fetch error (no connectivity, DNS failure, etc.) — the
    // caller (sync-service) treats this as retryable, never a hard failure.
    throw err;
  }

  const data = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? res.statusText, data?.issues);
  }
  return data as T;
}

/** True if this error looks transient and worth an automatic retry; false for a permanent client error. */
export function isRetryableApiError(err: unknown): boolean {
  if (err instanceof ApiError) {
    // 5xx, request timeout, and rate-limit are worth retrying automatically.
    // Everything else (400 validation, 401/403 auth, 404, 409 conflict) is a
    // permanent error for this exact payload — retrying it won't help.
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return true; // network-layer failures (fetch threw) are always retryable
}
