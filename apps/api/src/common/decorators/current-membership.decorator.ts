import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ActiveMembership } from '../../tenancy/membership.service';

/** The authenticated user's membership + resolved permission set for the tenant in `X-Tenant-Id`. */
export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ActiveMembership => {
    const request = ctx.switchToHttp().getRequest();
    return request.membership;
  },
);

export const CurrentTenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.membership.tenantId;
});
