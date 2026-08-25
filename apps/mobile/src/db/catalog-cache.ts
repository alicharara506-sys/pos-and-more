import { getDatabase } from './database';

export interface CachedVariant {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  availableQuantity: number;
  stockStatus: 'red' | 'yellow' | 'green';
  updatedAt: number;
}

export interface CachedCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  updatedAt: number;
}

export interface ActiveBranch {
  tenantId: string;
  branchId: string;
  branchName: string;
  stockLocationId: string;
  registerId: string | null;
}

export async function replaceCachedVariants(variants: CachedVariant[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cached_variants');
    for (const v of variants) {
      await db.runAsync(
        `INSERT INTO cached_variants (id, productId, productName, sku, barcode, retailPrice, availableQuantity, stockStatus, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v.id,
          v.productId,
          v.productName,
          v.sku,
          v.barcode,
          v.retailPrice,
          v.availableQuantity,
          v.stockStatus,
          v.updatedAt,
        ],
      );
    }
  });
}

export async function listCachedVariants(): Promise<CachedVariant[]> {
  const db = await getDatabase();
  return db.getAllAsync<CachedVariant>('SELECT * FROM cached_variants ORDER BY productName ASC');
}

/**
 * Applies a local, optimistic stock decrement so a second offline sale in
 * the same session doesn't oversell against a stale cached quantity. The
 * server-side ledger (apps/api's InventoryService) is still the real
 * source of truth and re-validates on sync — this is purely a same-device,
 * same-session UX guard.
 */
export async function decrementCachedStock(variantId: string, quantity: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE cached_variants SET availableQuantity = availableQuantity - ? WHERE id = ?',
    [quantity, variantId],
  );
}

export async function replaceCachedCustomers(customers: CachedCustomer[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cached_customers');
    for (const c of customers) {
      await db.runAsync(
        'INSERT INTO cached_customers (id, name, email, phone, updatedAt) VALUES (?, ?, ?, ?, ?)',
        [c.id, c.name, c.email, c.phone, c.updatedAt],
      );
    }
  });
}

export async function listCachedCustomers(): Promise<CachedCustomer[]> {
  const db = await getDatabase();
  return db.getAllAsync<CachedCustomer>('SELECT * FROM cached_customers ORDER BY name ASC');
}

export async function setActiveBranch(branch: ActiveBranch): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO active_branch (id, tenantId, branchId, branchName, stockLocationId, registerId)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET tenantId=excluded.tenantId, branchId=excluded.branchId,
       branchName=excluded.branchName, stockLocationId=excluded.stockLocationId, registerId=excluded.registerId`,
    [
      branch.tenantId,
      branch.branchId,
      branch.branchName,
      branch.stockLocationId,
      branch.registerId,
    ],
  );
}

export async function getActiveBranch(): Promise<ActiveBranch | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ActiveBranch>('SELECT * FROM active_branch WHERE id = 1');
  return row ?? undefined;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, value],
  );
}

export async function getSyncMeta(key: string): Promise<string | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    [key],
  );
  return row?.value;
}
