import { apiRequest } from '../api/client';
import {
  replaceCachedCustomers,
  replaceCachedVariants,
  setActiveBranch,
  setSyncMeta,
  type CachedCustomer,
  type CachedVariant,
} from '../db/catalog-cache';

interface ApiVariant {
  id: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  availableQuantity: number;
  stockStatus: 'red' | 'yellow' | 'green';
}
interface ApiProduct {
  id: string;
  name: string;
  variants: ApiVariant[];
}
interface ApiCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}
interface ApiBranch {
  id: string;
  name: string;
  stockLocations: Array<{ id: string; isDefault: boolean }>;
  registers: Array<{ id: string }>;
}

/**
 * Pulls the authorized catalog/customer/branch data for the current tenant
 * down into the local SQLite cache — this is the ONLY thing this app ever
 * calls while it has connectivity that isn't itself a queued mutation.
 * Everything it caches is exactly what the API would have returned to this
 * user for this tenant anyway (spec §9: "cache authorized products,
 * variants, customers ... relevant stock snapshots"), never more.
 */
export async function syncCatalogDown(tenantId: string): Promise<void> {
  const [products, customers, branches] = await Promise.all([
    apiRequest<{ products: ApiProduct[] }>('/products', { tenantId, query: { pageSize: 100 } }),
    apiRequest<{ customers: ApiCustomer[] }>('/customers', { tenantId, query: { pageSize: 100 } }),
    apiRequest<ApiBranch[]>('/branches', { tenantId }),
  ]);

  const variants: CachedVariant[] = products.products.flatMap((p) =>
    p.variants.map((v) => ({
      id: v.id,
      productId: p.id,
      productName: p.name,
      sku: v.sku,
      barcode: v.barcode,
      retailPrice: v.retailPrice,
      availableQuantity: v.availableQuantity,
      stockStatus: v.stockStatus,
      updatedAt: Date.now(),
    })),
  );
  await replaceCachedVariants(variants);

  const cachedCustomers: CachedCustomer[] = customers.customers.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    updatedAt: Date.now(),
  }));
  await replaceCachedCustomers(cachedCustomers);

  const branch = branches[0];
  if (branch) {
    const stockLocation =
      branch.stockLocations.find((l) => l.isDefault) ?? branch.stockLocations[0];
    if (stockLocation) {
      await setActiveBranch({
        tenantId,
        branchId: branch.id,
        branchName: branch.name,
        stockLocationId: stockLocation.id,
        registerId: branch.registers[0]?.id ?? null,
      });
    }
  }

  await setSyncMeta('lastCatalogSyncAt', String(Date.now()));
}
