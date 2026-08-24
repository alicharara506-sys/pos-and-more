import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { BranchesController } from './branches.controller';

@Module({
  imports: [AuditModule, BillingModule],
  controllers: [BranchesController],
})
export class BranchesModule {}
