/** A minimal fake `fetch` for adapter tests — no real network I/O. */
export interface FakeCall {
  url: string;
  init?: RequestInit;
}

export function createFakeFetch(
  responder: (call: FakeCall) => { status?: number; body: unknown },
  calls: FakeCall[] = [],
): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const { status, body } = responder({ url, init });
    return new Response(JSON.stringify(body), { status: status ?? 200 });
  }) as typeof fetch;
}
