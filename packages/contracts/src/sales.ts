import { z } from 'zod';

export const paymentMethodSchema = z.enum([
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'MOBILE_MONEY',
  'CUSTOMER_CREDIT',
  'CUSTOM',
]);

export const createSaleLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPriceOverride: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional(),
});

export const createSalePaymentSchema = z.object({
  method: paymentMethodSchema,
  amount: z.number().positive(),
  reference: z.string().trim().max(200).optional(),
});

/**
 * `clientMutationId` is the client-generated UUID used for offline-sync
 * idempotency (see docs/offline-sync.md) — the same sale replayed with the
 * same clientMutationId must never be recorded twice.
 */
export const createSaleSchema = z.object({
  clientMutationId: z.string().uuid(),
  branchId: z.string().uuid(),
  registerId: z.string().uuid().optional(),
  stockLocationId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  lines: z.array(createSaleLineSchema).min(1),
  payments: z.array(createSalePaymentSchema).min(1),
  note: z.string().trim().max(1000).optional(),
  currency: z.string().length(3).default('USD'),
  occurredAt: z.coerce.date().optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const refundSaleSchema = z.object({
  amount: z.number().positive().optional(), // omit = full refund
  reason: z.string().trim().max(500).optional(),
  restock: z.boolean().default(true),
});
export type RefundSaleInput = z.infer<typeof refundSaleSchema>;

export const listSalesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z
    .enum(['OPEN', 'HELD', 'COMPLETED', 'VOIDED', 'REFUNDED', 'PARTIALLY_REFUNDED'])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
