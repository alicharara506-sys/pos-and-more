import { z } from 'zod';

export const inventoryMovementTypeSchema = z.enum([
  'OPENING_BALANCE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RECEIPT',
  'SUPPLIER_RETURN',
  'ADJUSTMENT',
  'TRANSFER_DISPATCH',
  'TRANSFER_RECEIPT',
  'DAMAGE',
  'EXPIRY',
  'RESERVATION',
  'RESERVATION_RELEASE',
]);

export const createInventoryAdjustmentSchema = z.object({
  stockLocationId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantityDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'quantityDelta must not be zero'),
  type: inventoryMovementTypeSchema.default('ADJUSTMENT'),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});
export type CreateInventoryAdjustmentInput = z.infer<typeof createInventoryAdjustmentSchema>;

export const createStockTransferSchema = z.object({
  fromStockLocationId: z.string().uuid(),
  toStockLocationId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  note: z.string().trim().max(500).optional(),
});
export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;
