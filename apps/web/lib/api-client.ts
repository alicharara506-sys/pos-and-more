const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  tenantId?: string | null;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Thin fetch wrapper shared by every screen. Always sends credentials
 * (session cookie) and, when a tenant is selected, the X-Tenant-Id header
 * TenantGuard requires server-side — see apps/api/src/common/guards.
 * Never fabricates a success response: a non-2xx status always throws.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.tenantId ? { 'X-Tenant-Id': options.tenantId } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? res.statusText, data?.issues);
  }
  return data as T;
}

export function googleLoginUrl(): string {
  return `${API_BASE}/auth/google/start`;
}

export function appleLoginUrl(): string {
  return `${API_BASE}/auth/apple/start`;
}
