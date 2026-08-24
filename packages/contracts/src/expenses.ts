import { z } from 'zod';

export const createExpenseSchema = z.object({
  branchId: z.string().uuid(),
  categoryId: z.string().uuid(),
  vendor: z.string().trim().max(300).optional(),
  amount: z.number().positive(),
  taxAmount: z.number().nonnegative().default(0),
  date: z.coerce.date(),
  paymentAccount: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  receiptUrl: z.string().url().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
