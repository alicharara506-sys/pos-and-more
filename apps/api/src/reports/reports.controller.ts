import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@salesmaster/domain';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RbacGuard } from '../common/guards/rbac.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-membership.decorator';
import { ReportsService } from './reports.service';

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
}
