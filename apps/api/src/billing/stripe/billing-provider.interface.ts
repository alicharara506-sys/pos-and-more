/**
 * Typed boundary in front of Stripe (or any future billing provider).
 * Nothing outside packages/billing/stripe should import the `stripe` SDK
 * directly — see section 1.2 "keep external providers behind typed adapter
 * interfaces".
 */
export interface BillingCustomerInput {
  tenantId: string;
  email: string;
  name: string;
}

export interface BillingSubscriptionItemInput {
  stripePriceId: string;
  quantity: number;
}

export interface CreateSubscriptionInput {
  externalCustomerId: string;
  items: BillingSubscriptionItemInput[];
  trialDays?: number;
}

export interface ProviderSubscriptionState {
  externalSubscriptionId: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export interface BillingProvider {
  readonly name: 'stripe' | 'none';
  isConfigured(): boolean;
  createCustomer(input: BillingCustomerInput): Promise<{ externalCustomerId: string }>;
  createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscriptionState>;
  updateSubscriptionItemQuantity(
    externalSubscriptionId: string,
    stripePriceId: string,
    quantity: number,
  ): Promise<void>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  /** Verifies the webhook signature and returns the parsed event, or throws. */
  constructWebhookEvent(rawBody: Buffer, signatureHeader: string): unknown;
}
