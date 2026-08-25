import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@salesmaster/domain';
import { salesReportQuerySchema } from '@salesmaster/contracts';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';
import type { SalesReportQuery } from '@salesmaster/contracts';

@ApiTags('reports')
@UseGuards(SessionAuthGuard, TenantGuard, RbacGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async dashboard(@CurrentTenantId() tenantId: string, @Query('branchId') branchId?: string) {
    return this.reports.getDashboard(tenantId, branchId);
  }

  @Get('sales')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async sales(
    @CurrentTenantId() tenantId: string,
    @Query(new ZodValidationPipe(salesReportQuerySchema)) query: unknown,
  ) {
    const q = query as SalesReportQuery;
    return this.reports.getSalesByPeriod(tenantId, q.from, q.to, q.groupBy, q.branchId);
  }

  @Get('sales/export.csv')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async salesCsv(
    @CurrentTenantId() tenantId: string,
    @Query(new ZodValidationPipe(salesReportQuerySchema)) query: unknown,
    @Res() res: Response,
  ) {
    const q = query as SalesReportQuery;
    const csv = await this.reports.salesReportCsv(tenantId, q.from, q.to, q.groupBy, q.branchId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    res.status(200).send(csv);
  }

  @Get('inventory-valuation')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async inventoryValuation(@CurrentTenantId() tenantId: string) {
    return this.reports.getInventoryValuation(tenantId);
  }
}
