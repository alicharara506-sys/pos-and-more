import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(300),
  company: z.string().trim().max(300).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(50).optional(),
  birthday: z.coerce.date().optional(),
  taxId: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(5000).optional(),
  creditLimit: z.number().nonnegative().default(0),
  paymentTermsDays: z.number().int().nonnegative().default(0),
  tags: z.array(z.string().trim().max(50)).default([]),
  consentMarketing: z.boolean().default(false),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'AT_RISK', 'VIP', 'WHOLESALE']).optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const listCustomersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'AT_RISK', 'VIP', 'WHOLESALE']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
