import { z } from 'zod';

export const commerceProviderSchema = z.enum(['WOOCOMMERCE', 'SHOPIFY', 'UNIVERSAL_REST']);

export const createCommerceConnectionSchema = z.object({
  provider: commerceProviderSchema,
  name: z.string().trim().min(1).max(200),
  storeUrl: z.string().url(),
  credentials: z.record(z.string()),
});
export type CreateCommerceConnectionInput = z.infer<typeof createCommerceConnectionSchema>;

export const triggerSyncSchema = z.object({
  domain: z.enum(['PRODUCTS', 'INVENTORY', 'ORDERS', 'CUSTOMERS']),
});
export type TriggerSyncInput = z.infer<typeof triggerSyncSchema>;
