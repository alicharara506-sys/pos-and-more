import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@salesmaster/domain';
import { createExpenseSchema, listExpensesQuerySchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ExpensesService } from './expenses.service';
import type { User } from '@salesmaster/database';

const createCategorySchema = z.object({ name: z.string().trim().min(1).max(200) });

@ApiTags('expenses')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EXPENSES_VIEW)
  async list(
    @CurrentTenantId() tenantId: string,
    @Query(new ZodValidationPipe(listExpensesQuerySchema)) query: unknown,
  ) {
    return this.expenses.list(
      tenantId,
      query as import('@salesmaster/contracts').ListExpensesQuery,
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXPENSES_MANAGE)
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createExpenseSchema)) body: unknown,
  ) {
    return this.expenses.create(
      tenantId,
      user.id,
      body as import('@salesmaster/contracts').CreateExpenseInput,
    );
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.EXPENSES_VIEW)
  async listCategories(@CurrentTenantId() tenantId: string) {
    return this.expenses.listCategories(tenantId);
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.EXPENSES_MANAGE)
  async createCategory(
    @CurrentTenantId() tenantId: string,
    @Body(new ZodValidationPipe(createCategorySchema)) body: unknown,
  ) {
    const input = body as z.infer<typeof createCategorySchema>;
    return this.expenses.createCategory(tenantId, input.name);
  }
}
