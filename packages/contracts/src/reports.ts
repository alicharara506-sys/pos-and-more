import { z } from 'zod';

export const salesReportQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  branchId: z.string().uuid().optional(),
});
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
