import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipService } from '../../tenancy/membership.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const TENANT_HEADER = 'x-tenant-id';

/**
 * Resolves the tenant a request operates on from the `X-Tenant-Id` header and
 * verifies the authenticated user has an ACTIVE membership in it. Runs after
 * SessionAuthGuard. This is the enforcement point that makes cross-tenant
 * access impossible regardless of what tenant ID a client puts in a URL,
 * query param, or body — those are ignored; only the verified membership
 * counts (see docs/security.md §Tenant isolation).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly membershipService: MembershipService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = request.headers[TENANT_HEADER];

    if (!tenantId || typeof tenantId !== 'string') {
      throw new ForbiddenException(`Missing required ${TENANT_HEADER} header`);
    }

    const membership = await this.membershipService.getActiveMembership(request.user.id, tenantId);
    if (!membership) {
      throw new ForbiddenException('No active membership for this tenant');
    }

    request.membership = membership;
    return true;
  }
}
