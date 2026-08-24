import { z } from 'zod';

export const billingPreviewRequestSchema = z.object({
  addOnKeys: z.array(z.string()).default([]),
});
export type BillingPreviewRequest = z.infer<typeof billingPreviewRequestSchema>;

export const billingLineItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  unitPriceUsdCents: z.number().int().nonnegative(),
  totalUsdCents: z.number().int().nonnegative(),
});

export const billingPreviewResponseSchema = z.object({
  lineItems: z.array(billingLineItemSchema),
  totalUsdCents: z.number().int().nonnegative(),
  totalUsd: z.string(),
  activeBranchCount: z.number().int().positive(),
  billableUserCount: z.number().int().positive(),
});
export type BillingPreviewResponse = z.infer<typeof billingPreviewResponseSchema>;
