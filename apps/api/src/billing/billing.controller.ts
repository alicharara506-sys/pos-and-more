import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import { billingPreviewRequestSchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import {
  CurrentMembership,
  CurrentTenantId,
} from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@salesmaster/database';

@ApiTags('billing')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('preview')
  async preview(
    @CurrentTenantId() tenantId: string,
    @Body(new ZodValidationPipe(billingPreviewRequestSchema)) body: unknown,
  ) {
    const input = body as import('@salesmaster/contracts').BillingPreviewRequest;
    return this.billing.previewBilling(tenantId, input.addOnKeys);
  }

  @Get('subscription')
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  async getSubscription(@CurrentTenantId() tenantId: string) {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { tenantId },
      include: { items: { include: { pricingCatalogItem: true } } },
    });
    const preview = await this.billing.previewBilling(tenantId);
    return { subscription, preview };
  }

  @Post('cancel')
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  async cancel(@CurrentTenantId() tenantId: string, @CurrentUser() user: User) {
    await this.billing.cancelSubscription(tenantId, user.id);
    return { canceled: true };
  }
}
