import { BadRequestException, Controller, Headers, Inject, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { SubscriptionStatus } from '@salesmaster/database';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { BILLING_PROVIDER, type BillingProvider } from '../stripe/billing-provider.interface';

/**
 * Stripe webhook receiver. Verifies the signature cryptographically before
 * touching the DB, and is idempotent via BillingEvent.stripeEventId's unique
 * constraint — a replayed event is a harmless no-op, never a double-applied
 * state change (spec §4.4, acceptance test area "webhooks processed
 * idempotently").
 */
@ApiExcludeController()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  @Public()
  @Post('stripe')
  async handleStripeWebhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Webhook route must receive the raw request body');
    }

    const event = this.provider.constructWebhookEvent(req.body, signature) as Stripe.Event;

    const alreadyProcessed = await this.prisma.client.billingEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (alreadyProcessed) {
      return { received: true, deduplicated: true };
    }

    const subscriptionObject = event.data.object as {
      id?: string;
      metadata?: Record<string, string>;
    };
    const tenantId = await this.resolveTenantId(subscriptionObject);

    if (tenantId) {
      await this.applyEvent(tenantId, event);
    }

    return { received: true };
  }

  private async resolveTenantId(obj: {
    id?: string;
    metadata?: Record<string, string>;
  }): Promise<string | null> {
    if (obj.metadata?.tenantId) return obj.metadata.tenantId;
    if (obj.id) {
      const subscription = await this.prisma.client.subscription.findFirst({
        where: { stripeSubscriptionId: obj.id },
      });
      if (subscription) return subscription.tenantId;
    }
    return null;
  }

  private async applyEvent(tenantId: string, event: Stripe.Event): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.billingEvent.create({
        data: {
          tenantId,
          type: event.type,
          stripeEventId: event.id,
          payload: event as unknown as object,
          processedAt: new Date(),
        },
      });

      switch (event.type) {
        case 'customer.subscription.updated':
        case 'customer.subscription.created': {
          const sub = event.data.object as Stripe.Subscription;
          await tx.subscription.update({
            where: { tenantId },
            data: {
              status: mapStripeStatus(sub.status),
              currentPeriodStart: new Date(sub.current_period_start * 1000),
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
              trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            },
          });
          break;
        }
        case 'customer.subscription.deleted': {
          await tx.subscription.update({
            where: { tenantId },
            data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
          });
          break;
        }
        case 'invoice.payment_failed': {
          await tx.subscription.update({
            where: { tenantId },
            data: { status: SubscriptionStatus.PAST_DUE },
          });
          break;
        }
        default:
          break; // BillingEvent row is still recorded above for audit/history.
      }
    });
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
    case 'unpaid':
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}
