import { Inject, Injectable } from '@nestjs/common';
import { calculateMonthlyBilling, type BillingCalculationResult } from '@salesmaster/domain';
import { MembershipStatus, SubscriptionStatus, type Prisma } from '@salesmaster/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingCatalogService } from './pricing-catalog.service';
import { BILLING_PROVIDER, type BillingProvider } from './stripe/billing-provider.interface';

type PrismaTx = Prisma.TransactionClient;

export interface BillingPreview extends BillingCalculationResult {
  activeBranchCount: number;
  billableUserCount: number;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PricingCatalogService,
    private readonly audit: AuditService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  private async countBillableUnits(
    tenantId: string,
    tx: PrismaTx | PrismaService['client'] = this.prisma.client,
  ) {
    const [activeBranchCount, billableUserCount] = await Promise.all([
      tx.branch.count({ where: { tenantId, isActive: true } }),
      tx.membership.count({
        where: { tenantId, status: MembershipStatus.ACTIVE, isBillableUser: true },
      }),
    ]);
    return {
      activeBranchCount: Math.max(1, activeBranchCount),
      billableUserCount: Math.max(1, billableUserCount),
    };
  }

  /** Live, transparent price preview — must be shown before any billable branch/user is activated (spec §4.4). */
  async previewBilling(tenantId: string, addOnKeys: string[] = []): Promise<BillingPreview> {
    const [{ activeBranchCount, billableUserCount }, catalog] = await Promise.all([
      this.countBillableUnits(tenantId),
      this.catalog.resolve(),
    ]);

    const selectedAddOns = catalog.addOns.filter((a) => addOnKeys.includes(a.key));

    const result = calculateMonthlyBilling({
      activeBranchCount,
      billableUserCount,
      basePriceUsdCents: catalog.basePriceUsdCents,
      branchPriceUsdCents: catalog.branchPriceUsdCents,
      userPriceUsdCents: catalog.userPriceUsdCents,
      addOns: selectedAddOns.map((a) => ({
        key: a.key,
        name: a.name,
        unitPriceUsdCents: a.unitPriceUsdCents,
        quantity: 1,
      })),
    });

    return { ...result, activeBranchCount, billableUserCount };
  }

  /**
   * Recomputes branch/user quantities from the current DB state and
   * persists them as SubscriptionItem rows, pushing the change to the
   * billing provider if one is configured. Called after every branch or
   * membership activation/deactivation so entitlements never drift from
   * reality (spec acceptance test #4: concurrent creation must not under-
   * or over-charge). Uses a single DB transaction with the count query and
   * the upsert so concurrent callers serialize on Postgres row locks rather
   * than racing.
   */
  async recomputeSubscriptionItems(tenantId: string): Promise<BillingPreview> {
    const catalog = await this.catalog.resolve();

    const preview = await this.prisma.client.$transaction(async (tx) => {
      const { activeBranchCount, billableUserCount } = await this.countBillableUnits(tenantId, tx);

      const subscription = await tx.subscription.findUnique({ where: { tenantId } });
      if (!subscription) {
        throw new Error(
          `Tenant ${tenantId} has no subscription — onboarding did not complete atomically`,
        );
      }

      const pricingRows = await tx.pricingCatalogItem.findMany({
        where: { key: { in: ['base', 'extra_branch', 'extra_user'] } },
      });
      const baseItem = pricingRows.find((r) => r.key === 'base');
      const branchItem = pricingRows.find((r) => r.key === 'extra_branch');
      const userItem = pricingRows.find((r) => r.key === 'extra_user');

      const extraBranches = Math.max(0, activeBranchCount - 1);
      const extraUsers = Math.max(0, billableUserCount - 1);

      if (baseItem) {
        await tx.subscriptionItem.upsert({
          where: {
            subscriptionId_pricingCatalogItemId: {
              subscriptionId: subscription.id,
              pricingCatalogItemId: baseItem.id,
            },
          },
          create: {
            subscriptionId: subscription.id,
            pricingCatalogItemId: baseItem.id,
            quantity: 1,
            unitPriceUsdCentsSnapshot: baseItem.unitPriceUsdCents,
          },
          update: { quantity: 1 },
        });
      }
      if (branchItem) {
        await tx.subscriptionItem.upsert({
          where: {
            subscriptionId_pricingCatalogItemId: {
              subscriptionId: subscription.id,
              pricingCatalogItemId: branchItem.id,
            },
          },
          create: {
            subscriptionId: subscription.id,
            pricingCatalogItemId: branchItem.id,
            quantity: extraBranches,
            unitPriceUsdCentsSnapshot: branchItem.unitPriceUsdCents,
          },
          update: { quantity: extraBranches },
        });
      }
      if (userItem) {
        await tx.subscriptionItem.upsert({
          where: {
            subscriptionId_pricingCatalogItemId: {
              subscriptionId: subscription.id,
              pricingCatalogItemId: userItem.id,
            },
          },
          create: {
            subscriptionId: subscription.id,
            pricingCatalogItemId: userItem.id,
            quantity: extraUsers,
            unitPriceUsdCentsSnapshot: userItem.unitPriceUsdCents,
          },
          update: { quantity: extraUsers },
        });
      }

      await this.audit.record(
        {
          tenantId,
          actorUserId: null,
          action: 'billing.entitlements_recomputed',
          entityType: 'Subscription',
          entityId: subscription.id,
          metadata: { activeBranchCount, billableUserCount },
        },
        tx,
      );

      return calculateMonthlyBilling({
        activeBranchCount,
        billableUserCount,
        basePriceUsdCents: catalog.basePriceUsdCents,
        branchPriceUsdCents: catalog.branchPriceUsdCents,
        userPriceUsdCents: catalog.userPriceUsdCents,
      });
    });

    // Push to the external provider outside the DB transaction (never hold
    // a transaction open across a network call).
    if (this.provider.isConfigured()) {
      const subscription = await this.prisma.client.subscription.findUnique({
        where: { tenantId },
      });
      if (subscription?.stripeSubscriptionId) {
        const rows = await this.prisma.client.pricingCatalogItem.findMany({
          where: { key: { in: ['extra_branch', 'extra_user'] } },
        });
        for (const row of rows) {
          if (!row.stripePriceId) continue;
          const item = await this.prisma.client.subscriptionItem.findUnique({
            where: {
              subscriptionId_pricingCatalogItemId: {
                subscriptionId: subscription.id,
                pricingCatalogItemId: row.id,
              },
            },
          });
          if (item) {
            await this.provider.updateSubscriptionItemQuantity(
              subscription.stripeSubscriptionId,
              row.stripePriceId,
              item.quantity,
            );
          }
        }
      }
    }

    return { ...preview, ...(await this.countBillableUnits(tenantId)) };
  }

  async cancelSubscription(tenantId: string, actorUserId: string): Promise<void> {
    const subscription = await this.prisma.client.subscription.findUniqueOrThrow({
      where: { tenantId },
    });

    if (this.provider.isConfigured() && subscription.stripeSubscriptionId) {
      await this.provider.cancelSubscription(subscription.stripeSubscriptionId);
    }

    await this.prisma.client.subscription.update({
      where: { tenantId },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
        cancelAtPeriodEnd: true,
      },
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'billing.subscription_canceled',
      entityType: 'Subscription',
      entityId: subscription.id,
    });
  }
}
