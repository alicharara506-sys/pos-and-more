import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  MembershipStatus,
  SubscriptionStatus,
  TenantStatus,
  type Branch,
  type Tenant,
  type User,
} from '@salesmaster/database';
import type { CreateTenantOnboardingInput, InviteUserInput } from '@salesmaster/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { PricingCatalogService } from '../billing/pricing-catalog.service';

const TRIAL_DAYS = 14;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly billing: BillingService,
    private readonly catalog: PricingCatalogService,
  ) {}

  /**
   * Creates the tenant, first branch, owner membership, and trial
   * subscription in a single DB transaction so onboarding can never leave a
   * partially configured tenant (spec §3.3). External billing-provider
   * calls happen after commit (never inside the transaction) — see
   * BillingService.
   */
  async createTenant(
    owner: User,
    input: CreateTenantOnboardingInput,
  ): Promise<{ tenant: Tenant; branch: Branch }> {
    const catalog = await this.catalog.resolve();

    const { tenant, branch } = await this.prisma.client.$transaction(async (tx) => {
      const existingMembership = await tx.membership.findFirst({ where: { userId: owner.id } });
      if (existingMembership) {
        throw new BadRequestException(
          'This user already belongs to a tenant. Multi-tenant membership for a single onboarding flow is not yet supported.',
        );
      }

      const tenant = await tx.tenant.create({
        data: {
          legalName: input.legalName,
          displayName: input.displayName,
          category: input.category,
          country: input.country,
          locale: input.locale,
          timezone: input.timezone,
          baseCurrency: input.baseCurrency,
          status: TenantStatus.TRIALING,
        },
      });

      const branch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          name: input.firstBranchName,
          address: input.firstBranchAddress,
          timezone: input.timezone,
          currency: input.baseCurrency,
          isBillable: false, // the first branch is included in the base $10 subscription
        },
      });

      await tx.stockLocation.create({
        data: {
          tenantId: tenant.id,
          branchId: branch.id,
          name: `${branch.name} — Main Stock`,
          isDefault: true,
        },
      });

      await tx.register.create({
        data: { tenantId: tenant.id, branchId: branch.id, name: 'Register 1' },
      });

      const ownerRole = await tx.role.findFirst({ where: { tenantId: null, key: 'owner' } });
      if (!ownerRole) {
        throw new Error('System role "owner" is not seeded. Run `pnpm db:seed` before onboarding.');
      }

      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          roleId: ownerRole.id,
          status: MembershipStatus.ACTIVE,
          isBillableUser: true,
        },
      });

      const baseItem = catalog.basePriceUsdCents;
      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        },
      });

      const basePricingItem = await tx.pricingCatalogItem.findUnique({ where: { key: 'base' } });
      if (basePricingItem) {
        await tx.subscriptionItem.create({
          data: {
            subscriptionId: subscription.id,
            pricingCatalogItemId: basePricingItem.id,
            quantity: 1,
            unitPriceUsdCentsSnapshot: baseItem,
          },
        });
      }

      await this.audit.record(
        {
          tenantId: tenant.id,
          actorUserId: owner.id,
          action: 'onboarding.tenant_created',
          entityType: 'Tenant',
          entityId: tenant.id,
        },
        tx,
      );

      await this.outbox.publish(
        {
          aggregateType: 'Tenant',
          aggregateId: tenant.id,
          eventType: 'tenant.created',
          payload: { tenantId: tenant.id, ownerUserId: owner.id, ownerEmail: owner.email },
        },
        tx,
      );

      return { tenant, branch };
    });

    return { tenant, branch };
  }

  async inviteUser(tenantId: string, inviterUserId: string, input: InviteUserInput) {
    const role = await this.prisma.client.role.findFirst({
      where: { key: input.roleKey, OR: [{ tenantId }, { tenantId: null }] },
    });
    if (!role) throw new NotFoundException(`Role ${input.roleKey} not found`);

    const existingUser = await this.prisma.client.user.findUnique({
      where: { email: input.email },
    });
    if (existingUser) {
      const existingMembership = await this.prisma.client.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: existingUser.id } },
      });
      if (existingMembership) {
        throw new BadRequestException('This user is already a member of this tenant');
      }
    }

    const invitation = await this.prisma.client.invitation.create({
      data: {
        tenantId,
        email: input.email,
        roleId: role.id,
        token: nanoid(32),
        invitedByUserId: inviterUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.outbox.publish({
      aggregateType: 'Invitation',
      aggregateId: invitation.id,
      eventType: 'invitation.created',
      payload: { tenantId, email: input.email, token: invitation.token },
    });

    await this.audit.record({
      tenantId,
      actorUserId: inviterUserId,
      action: 'onboarding.user_invited',
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { email: input.email, roleKey: input.roleKey },
    });

    return invitation;
  }

  async acceptInvitation(token: string, acceptingUser: User) {
    const invitation = await this.prisma.client.invitation.findUnique({ where: { token } });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new BadRequestException('This invitation is invalid or has expired');
    }
    if (invitation.email !== acceptingUser.email) {
      throw new BadRequestException('This invitation was issued to a different email address');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.membership.create({
        data: {
          tenantId: invitation.tenantId,
          userId: acceptingUser.id,
          roleId: invitation.roleId,
          status: MembershipStatus.ACTIVE,
          isBillableUser: true,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await this.audit.record(
        {
          tenantId: invitation.tenantId,
          actorUserId: acceptingUser.id,
          action: 'onboarding.invitation_accepted',
          entityType: 'Invitation',
          entityId: invitation.id,
        },
        tx,
      );
    });

    // Recompute billing outside the transaction — activating a new billable
    // user changes the subscription total (spec acceptance test #3).
    await this.billing.recomputeSubscriptionItems(invitation.tenantId);

    return { tenantId: invitation.tenantId };
  }
}
