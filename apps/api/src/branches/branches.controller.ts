import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@salesmaster/domain';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { User } from '@salesmaster/database';

const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  timezone: z.string().min(1).max(100),
  currency: z.string().length(3).default('USD'),
});

@ApiTags('branches')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentTenantId() tenantId: string) {
    return this.prisma.client.branch.findMany({
      where: { tenantId },
      include: { stockLocations: true, registers: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Activating a second (or later) branch changes the monthly subtotal by
   * exactly the catalog branch price (spec acceptance test #2). The new
   * branch is billable by default; recomputeSubscriptionItems runs
   * immediately after commit so entitlements never drift.
   */
  @Post()
  @RequirePermissions(PERMISSIONS.BRANCHES_MANAGE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createBranchSchema)) body: unknown,
  ) {
    const input = body as z.infer<typeof createBranchSchema>;

    const branch = await this.prisma.client.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          tenantId,
          name: input.name,
          address: input.address,
          timezone: input.timezone,
          currency: input.currency,
        },
      });
      await tx.stockLocation.create({
        data: {
          tenantId,
          branchId: branch.id,
          name: `${branch.name} — Main Stock`,
          isDefault: true,
        },
      });
      await tx.register.create({ data: { tenantId, branchId: branch.id, name: 'Register 1' } });
      await this.audit.record(
        {
          tenantId,
          actorUserId: user.id,
          action: 'branches.created',
          entityType: 'Branch',
          entityId: branch.id,
        },
        tx,
      );
      return branch;
    });

    const billingPreview = await this.billing.recomputeSubscriptionItems(tenantId);
    return { branch, billingPreview };
  }

  @Patch(':id/archive')
  @RequirePermissions(PERMISSIONS.BRANCHES_MANAGE)
  async archive(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    // updateMany scoped by (id AND tenantId) so a branch ID from another
    // tenant simply matches zero rows instead of ever being touched.
    const { count } = await this.prisma.client.branch.updateMany({
      where: { id, tenantId },
      data: { isActive: false, archivedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('Branch not found');
    }
    const branch = await this.prisma.client.branch.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      tenantId,
      actorUserId: user.id,
      action: 'branches.archived',
      entityType: 'Branch',
      entityId: id,
    });
    const billingPreview = await this.billing.recomputeSubscriptionItems(tenantId);
    return { branch, billingPreview };
  }
}
