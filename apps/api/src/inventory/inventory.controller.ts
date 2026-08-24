import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import { createInventoryAdjustmentSchema, createStockTransferSchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InventoryService } from './inventory.service';
import type { User } from '@salesmaster/database';

@ApiTags('inventory')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('adjustments')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  async adjust(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createInventoryAdjustmentSchema)) body: unknown,
  ) {
    return this.inventory.adjustStock(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateInventoryAdjustmentInput,
    );
  }

  @Post('transfers')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  async transfer(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createStockTransferSchema)) body: unknown,
  ) {
    return this.inventory.transferStock(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateStockTransferInput,
    );
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async movements(
    @CurrentTenantId() tenantId: string,
    @Query('stockLocationId') stockLocationId: string,
    @Query('variantId') variantId: string,
  ) {
    return this.inventory.listMovements(tenantId, stockLocationId, variantId);
  }
}
