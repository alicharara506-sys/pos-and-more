import { describe, expect, it } from 'vitest';
import { MembershipService, type ActiveMembership } from './membership.service';

function membership(branchScope: string[]): ActiveMembership {
  return {
    membershipId: 'm1',
    tenantId: 't1',
    userId: 'u1',
    roleId: 'r1',
    roleKey: 'manager',
    branchScope,
    permissions: new Set(),
  };
}

describe('MembershipService.canAccessBranch', () => {
  const service = new MembershipService(undefined as never);

  it('grants access to every branch when branchScope is empty (unrestricted)', () => {
    expect(service.canAccessBranch(membership([]), 'branch-a')).toBe(true);
    expect(service.canAccessBranch(membership([]), 'branch-b')).toBe(true);
  });

  it('grants access only to branches explicitly listed in a restricted scope', () => {
    const restricted = membership(['branch-a']);
    expect(service.canAccessBranch(restricted, 'branch-a')).toBe(true);
    expect(service.canAccessBranch(restricted, 'branch-b')).toBe(false);
  });
});
