import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CustomersService } from './customers.service';
import type { User } from '@salesmaster/database';

@ApiTags('customers')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  async list(
    @CurrentTenantId() tenantId: string,
    @Query(new ZodValidationPipe(listCustomersQuerySchema)) query: unknown,
  ) {
    return this.customers.list(
      tenantId,
      query as import('@salesmaster/contracts').ListCustomersQuery,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  async get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.customers.get(tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createCustomerSchema)) body: unknown,
  ) {
    return this.customers.create(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateCustomerInput,
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  async update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: unknown,
  ) {
    return this.customers.update(
      tenantId,
      user.id,
      id,
      body as import('@salesmaster/contracts').UpdateCustomerInput,
    );
  }
}
