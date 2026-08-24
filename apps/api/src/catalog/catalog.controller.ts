import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CatalogService } from './catalog.service';
import type { User } from '@salesmaster/database';

@ApiTags('catalog')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async list(
    @CurrentTenantId() tenantId: string,
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: unknown,
  ) {
    return this.catalog.listProducts(
      tenantId,
      query as import('@salesmaster/contracts').ListProductsQuery,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.getProduct(tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createProductSchema)) body: unknown,
  ) {
    return this.catalog.createProduct(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateProductInput,
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  async update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: unknown,
  ) {
    return this.catalog.updateProduct(
      tenantId,
      user.id,
      id,
      body as import('@salesmaster/contracts').UpdateProductInput,
    );
  }
}
