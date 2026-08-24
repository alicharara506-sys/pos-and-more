import { Injectable } from '@nestjs/common';
import type {
  BillingCustomerInput,
  BillingProvider,
  CreateSubscriptionInput,
  ProviderSubscriptionState,
} from './billing-provider.interface';

/**
 * Fallback provider used when STRIPE_SECRET_KEY is not configured (default
 * in this environment — no live credentials are available). Tracks
 * subscription state entirely in our own database so onboarding and the
 * entitlement engine work end to end, but is honest that no real payment
 * method is being charged: every entitlement computed under this provider
 * must be presented to the merchant as "trial / unbilled", never as a
 * successful charge.
 */
@Injectable()
export class NullBillingProvider implements BillingProvider {
  readonly name = 'none' as const;

  isConfigured(): boolean {
    return false;
  }

  async createCustomer(input: BillingCustomerInput): Promise<{ externalCustomerId: string }> {
    return { externalCustomerId: `local_${input.tenantId}` };
  }

  async createSubscription(_input: CreateSubscriptionInput): Promise<ProviderSubscriptionState> {
    return {
      externalSubscriptionId: `local_sub_${Date.now()}`,
      status: 'trialing',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      trialEndsAt: null,
    };
  }

  async updateSubscriptionItemQuantity(): Promise<void> {
    // No external system to update.
  }

  async cancelSubscription(): Promise<void> {
    // No external system to update.
  }

  constructWebhookEvent(): never {
    throw new Error('Webhooks are not available without a configured billing provider');
  }
}
