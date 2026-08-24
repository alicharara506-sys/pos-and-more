import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { loadEnv } from '@salesmaster/config';
import type {
  BillingCustomerInput,
  BillingProvider,
  CreateSubscriptionInput,
  ProviderSubscriptionState,
} from './billing-provider.interface';

/** Real Stripe Billing integration. Only instantiated when STRIPE_SECRET_KEY is set. */
@Injectable()
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor() {
    const env = loadEnv();
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('StripeBillingProvider constructed without STRIPE_SECRET_KEY');
    }
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }

  isConfigured(): boolean {
    return true;
  }

  async createCustomer(input: BillingCustomerInput): Promise<{ externalCustomerId: string }> {
    const customer = await this.stripe.customers.create({
      email: input.email,
      name: input.name,
      metadata: { tenantId: input.tenantId },
    });
    return { externalCustomerId: customer.id };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscriptionState> {
    const subscription = await this.stripe.subscriptions.create({
      customer: input.externalCustomerId,
      items: input.items.map((item) => ({ price: item.stripePriceId, quantity: item.quantity })),
      trial_period_days: input.trialDays,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    return mapSubscription(subscription);
  }

  async updateSubscriptionItemQuantity(
    externalSubscriptionId: string,
    stripePriceId: string,
    quantity: number,
  ): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(externalSubscriptionId);
    const item = subscription.items.data.find((i) => i.price.id === stripePriceId);

    if (item) {
      await this.stripe.subscriptionItems.update(item.id, { quantity });
    } else {
      await this.stripe.subscriptionItems.create({
        subscription: externalSubscriptionId,
        price: stripePriceId,
        quantity,
      });
    }
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(externalSubscriptionId);
  }

  constructWebhookEvent(rawBody: Buffer, signatureHeader: string): Stripe.Event {
    const env = loadEnv();
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  }
}

function mapSubscription(subscription: Stripe.Subscription): ProviderSubscriptionState {
  return {
    externalSubscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000)
      : null,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
  };
}
