import { Module } from '@nestjs/common';
import { loadEnv } from '@salesmaster/config';
import { AuditModule } from '../audit/audit.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PricingCatalogService } from './pricing-catalog.service';
import { BillingWebhookController } from './webhooks/billing-webhook.controller';
import { BILLING_PROVIDER } from './stripe/billing-provider.interface';
import { StripeBillingProvider } from './stripe/stripe-billing.provider';
import { NullBillingProvider } from './stripe/null-billing.provider';

@Module({
  imports: [AuditModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService,
    PricingCatalogService,
    {
      provide: BILLING_PROVIDER,
      useFactory: () => {
        const env = loadEnv();
        return env.STRIPE_SECRET_KEY ? new StripeBillingProvider() : new NullBillingProvider();
      },
    },
  ],
  exports: [BillingService, PricingCatalogService, BILLING_PROVIDER],
})
export class BillingModule {}
