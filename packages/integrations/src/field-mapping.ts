/**
 * Minimal dot-path field mapping — the "field mapping" half of the
 * Universal REST connector's configurability (spec §13.1). A merchant (or
 * an admin acting on their behalf) configures which JSON path on the
 * external store's product/order payload maps to which canonical field,
 * without writing code.
 */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && key === '*') return acc; // caller handles array expansion explicitly
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function getStringByPath(obj: unknown, path: string, fallback = ''): string {
  const value = getByPath(obj, path);
  return value === null || value === undefined ? fallback : String(value);
}

export function getNumberByPath(obj: unknown, path: string, fallback = 0): number {
  const value = getByPath(obj, path);
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
