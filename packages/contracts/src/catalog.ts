import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional(),
  brand: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  unitOfMeasure: z.string().trim().min(1).max(50).default('each'),
  variants: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(100),
        barcode: z.string().trim().max(100).optional(),
        attributes: z.record(z.string()).default({}),
        costPrice: z.number().nonnegative(),
        retailPrice: z.number().nonnegative(),
        wholesalePrice: z.number().nonnegative().optional(),
        taxClassId: z.string().uuid().optional(),
        reorderPoint: z.number().int().nonnegative().default(0),
        reorderBuffer: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial().extend({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']).optional(),
  stockStatus: z.enum(['red', 'yellow', 'green']).optional(),
  branchId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
