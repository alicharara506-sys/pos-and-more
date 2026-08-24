import { Injectable, NotFoundException } from '@nestjs/common';
import { computeStockStatus, type StockStatus } from '@salesmaster/domain';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from '@salesmaster/contracts';
import { ProductStatus } from '@salesmaster/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createProduct(tenantId: string, actorUserId: string, input: CreateProductInput) {
    const existingSkus = await this.prisma.client.productVariant.findMany({
      where: { tenantId, sku: { in: input.variants.map((v) => v.sku) } },
      select: { sku: true },
    });
    if (existingSkus.length > 0) {
      throw new NotFoundException(
        `SKU(s) already in use: ${existingSkus.map((s) => s.sku).join(', ')}`,
      );
    }

    const product = await this.prisma.client.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          tenantId,
          name: input.name,
          description: input.description,
          brand: input.brand,
          categoryId: input.categoryId,
          unitOfMeasure: input.unitOfMeasure,
          variants: {
            create: input.variants.map((v) => ({
              tenantId,
              sku: v.sku,
              barcode: v.barcode,
              attributes: v.attributes,
              costPrice: v.costPrice,
              retailPrice: v.retailPrice,
              wholesalePrice: v.wholesalePrice,
              taxClassId: v.taxClassId,
              reorderPoint: v.reorderPoint,
              reorderBuffer: v.reorderBuffer,
            })),
          },
        },
        include: { variants: true },
      });

      await this.audit.record(
        {
          tenantId,
          actorUserId,
          action: 'products.created',
          entityType: 'Product',
          entityId: product.id,
        },
        tx,
      );

      return product;
    });

    return product;
  }

  async updateProduct(
    tenantId: string,
    actorUserId: string,
    productId: string,
    input: UpdateProductInput,
  ) {
    const existing = await this.prisma.client.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!existing) throw new NotFoundException('Product not found');

    const product = await this.prisma.client.product.update({
      where: { id: productId },
      data: {
        name: input.name,
        description: input.description,
        brand: input.brand,
        categoryId: input.categoryId,
        unitOfMeasure: input.unitOfMeasure,
        status: input.status as ProductStatus | undefined,
      },
      include: { variants: true },
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'products.updated',
      entityType: 'Product',
      entityId: productId,
    });
    return product;
  }

  async listProducts(tenantId: string, query: ListProductsQuery) {
    const products = await this.prisma.client.product.findMany({
      where: {
        tenantId,
        status: query.status,
        categoryId: query.categoryId,
        name: query.search ? { contains: query.search, mode: 'insensitive' } : undefined,
      },
      include: { variants: true, images: true },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    });

    const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
    const balances = variantIds.length
      ? await this.prisma.client.inventoryBalance.findMany({
          where: {
            variantId: { in: variantIds },
            stockLocationId: query.branchId
              ? {
                  in: (
                    await this.prisma.client.stockLocation.findMany({
                      where: { tenantId, branchId: query.branchId },
                      select: { id: true },
                    })
                  ).map((l) => l.id),
                }
              : undefined,
          },
        })
      : [];

    const balanceByVariant = new Map<string, number>();
    for (const balance of balances) {
      balanceByVariant.set(
        balance.variantId,
        (balanceByVariant.get(balance.variantId) ?? 0) + balance.quantity,
      );
    }

    const enriched = products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        const availableQuantity = balanceByVariant.get(variant.id) ?? 0;
        const stockStatus: StockStatus = computeStockStatus({
          availableQuantity,
          reorderPoint: variant.reorderPoint,
          warningBuffer: variant.reorderBuffer,
        });
        return { ...variant, availableQuantity, stockStatus };
      }),
    }));

    const filtered = query.stockStatus
      ? enriched.filter((p) => p.variants.some((v) => v.stockStatus === query.stockStatus))
      : enriched;

    return { products: filtered, page: query.page, pageSize: query.pageSize };
  }

  async getProduct(tenantId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, tenantId },
      include: { variants: true, images: true, category: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}
