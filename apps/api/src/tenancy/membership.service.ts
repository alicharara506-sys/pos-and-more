import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipStatus } from '@salesmaster/database';

export interface ActiveMembership {
  membershipId: string;
  tenantId: string;
  userId: string;
  roleId: string;
  roleKey: string;
  branchScope: string[];
  permissions: ReadonlySet<string>;
}

/**
 * Resolves a user's active membership + effective permission set for a
 * tenant. This is the single choke point tenant-isolation and RBAC both go
 * through — never trust a tenantId supplied by the client without going
 * through this lookup first.
 */
@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveMembership(userId: string, tenantId: string): Promise<ActiveMembership | null> {
    const membership = await this.prisma.client.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { role: { include: { permissions: true } } },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      return null;
    }

    const permissions = new Set(
      membership.role.permissions.filter((p) => p.allowed).map((p) => p.permissionKey),
    );

    return {
      membershipId: membership.id,
      tenantId: membership.tenantId,
      userId: membership.userId,
      roleId: membership.roleId,
      roleKey: membership.role.key,
      branchScope: membership.branchScope,
      permissions,
    };
  }

  /** True if the membership is unrestricted (owner/manager with empty branchScope) or explicitly scoped to this branch. */
  canAccessBranch(membership: ActiveMembership, branchId: string): boolean {
    return membership.branchScope.length === 0 || membership.branchScope.includes(branchId);
  }
}
