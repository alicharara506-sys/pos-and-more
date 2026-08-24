import { z } from 'zod';

export const invoiceLineInputSchema = z.object({
  variantId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().nonnegative(),
  taxAmount: z.number().nonnegative().default(0),
  discountAmount: z.number().nonnegative().default(0),
});

export const createInvoiceSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  dueDate: z.coerce.date().optional(),
  currency: z.string().length(3).default('USD'),
  notes: z.string().trim().max(2000).optional(),
  termsText: z.string().trim().max(2000).optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const recordInvoicePaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CUSTOMER_CREDIT', 'CUSTOM']),
  reference: z.string().trim().max(200).optional(),
});
export type RecordInvoicePaymentInput = z.infer<typeof recordInvoicePaymentSchema>;

export const createQuoteSchema = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  expiresAt: z.coerce.date().optional(),
  currency: z.string().length(3).default('USD'),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        description: z.string().trim().max(500).optional(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
