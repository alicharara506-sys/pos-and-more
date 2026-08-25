/** A minimal fake `fetch` for connector tests — routes by URL substring, no real network I/O. */
export interface FakeRoute {
  match: (url: string) => boolean;
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

export function createFakeFetch(routes: FakeRoute[]): typeof fetch {
  return (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes.find((r) => r.match(url));
    if (!route) {
      throw new Error(`No fake route matched ${url}`);
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: route.headers,
    });
  }) as typeof fetch;
}
