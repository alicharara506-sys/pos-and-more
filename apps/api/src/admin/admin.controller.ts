import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PricingItemKind } from '@salesmaster/database';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { User } from '@salesmaster/database';

const updatePricingItemSchema = z.object({
  unitPriceUsdCents: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

const createAddOnSchema = z.object({
  key: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  unitPriceUsdCents: z.number().int().nonnegative(),
});

/**
 * Platform-admin surface — a SEPARATE authorization path from tenant RBAC
 * (spec §2 "Platform Administrator: internal platform operations through a
 * separately protected admin surface"). Guarded only by PlatformAdminGuard,
 * never by TenantGuard/RbacGuard, and every mutation is audited.
 */
@ApiTags('admin')
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('tenants')
  async searchTenants(@Query('search') search?: string) {
    return this.prisma.client.tenant.findMany({
      where: search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { legalName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: { subscription: true, _count: { select: { branches: true, memberships: true } } },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('tenants/:id')
  async getTenant(@Param('id') id: string) {
    return this.prisma.client.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        subscription: { include: { items: { include: { pricingCatalogItem: true } } } },
        branches: true,
        memberships: { include: { user: true, role: true } },
      },
    });
  }

  @Get('metrics')
  async metrics() {
    const [activeTenants, trialingTenants, activeUsers, activeBranches, subscriptions] =
      await Promise.all([
        this.prisma.client.tenant.count({ where: { status: 'ACTIVE' } }),
        this.prisma.client.tenant.count({ where: { status: 'TRIALING' } }),
        this.prisma.client.membership.count({ where: { status: 'ACTIVE', isBillableUser: true } }),
        this.prisma.client.branch.count({ where: { isActive: true } }),
        this.prisma.client.subscription.findMany({
          where: { status: { in: ['ACTIVE', 'TRIALING'] } },
          include: { items: true },
        }),
      ]);

    const mrrUsdCents = subscriptions.reduce(
      (sum, sub) =>
        sum + sub.items.reduce((s, item) => s + item.unitPriceUsdCentsSnapshot * item.quantity, 0),
      0,
    );

    return {
      activeTenants,
      trialingTenants,
      activeUsers,
      activeBranches,
      mrrUsd: (mrrUsdCents / 100).toFixed(2),
    };
  }

  @Get('pricing-catalog')
  async listPricingCatalog() {
    return this.prisma.client.pricingCatalogItem.findMany({ orderBy: { kind: 'asc' } });
  }

  @Patch('pricing-catalog/:id')
  async updatePricingItem(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePricingItemSchema)) body: unknown,
  ) {
    const input = body as z.infer<typeof updatePricingItemSchema>;
    const item = await this.prisma.client.pricingCatalogItem.update({
      where: { id },
      data: {
        unitPriceUsdCents: input.unitPriceUsdCents,
        isActive: input.isActive,
        name: input.name,
        version: { increment: 1 },
      },
    });
    await this.audit.record({
      tenantId: null,
      actorUserId: admin.id,
      action: 'admin.pricing_catalog_updated',
      entityType: 'PricingCatalogItem',
      entityId: id,
      metadata: input,
    });
    return item;
  }

  @Post('pricing-catalog/add-ons')
  async createAddOn(
    @CurrentUser() admin: User,
    @Body(new ZodValidationPipe(createAddOnSchema)) body: unknown,
  ) {
    const input = body as z.infer<typeof createAddOnSchema>;
    const item = await this.prisma.client.pricingCatalogItem.create({
      data: {
        key: input.key,
        name: input.name,
        kind: PricingItemKind.ADDON,
        unitPriceUsdCents: input.unitPriceUsdCents,
      },
    });
    await this.audit.record({
      tenantId: null,
      actorUserId: admin.id,
      action: 'admin.pricing_addon_created',
      entityType: 'PricingCatalogItem',
      entityId: item.id,
      metadata: input,
    });
    return item;
  }
}
