import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { AuditModule } from './audit/audit.module';
import { OutboxModule } from './outbox/outbox.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AuthModule } from './auth/auth.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { BillingModule } from './billing/billing.module';
import { BranchesModule } from './branches/branches.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CommonModule,
    PrismaModule,
    AuditModule,
    OutboxModule,
    TenancyModule,
    AuthModule,
    OnboardingModule,
    BillingModule,
    BranchesModule,
    CatalogModule,
    InventoryModule,
    CustomersModule,
    SalesModule,
    InvoicesModule,
    ExpensesModule,
    ReportsModule,
    AdminModule,
    HealthModule,
    IntegrationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global: every route requires a valid session unless annotated
    // @Public() (auth entry points, OAuth callbacks, webhooks, public
    // invoice links). TenantGuard/RbacGuard stay controller-scoped since
    // they only apply to tenant-data routes.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
