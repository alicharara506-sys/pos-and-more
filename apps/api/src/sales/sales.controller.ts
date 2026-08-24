import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import { createSaleSchema, listSalesQuerySchema, refundSaleSchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SalesService } from './sales.service';
import type { User } from '@salesmaster/database';

@ApiTags('sales')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_VIEW)
  async list(
    @CurrentTenantId() tenantId: string,
    @Query(new ZodValidationPipe(listSalesQuerySchema)) query: unknown,
  ) {
    return this.sales.list(tenantId, query as import('@salesmaster/contracts').ListSalesQuery);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_VIEW)
  async get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.sales.get(tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSaleSchema)) body: unknown,
  ) {
    return this.sales.createSale(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateSaleInput,
    );
  }

  @Post(':id/refund')
  @RequirePermissions(PERMISSIONS.SALES_REFUND)
  async refund(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundSaleSchema)) body: unknown,
  ) {
    return this.sales.refundSale(
      tenantId,
      user.id,
      id,
      body as import('@salesmaster/contracts').RefundSaleInput,
    );
  }

  @Post(':id/void')
  @RequirePermissions(PERMISSIONS.SALES_VOID)
  async void_(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.sales.voidSale(tenantId, user.id, id);
  }
}
