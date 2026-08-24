import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@salesmaster/domain';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { ActiveMembership } from '../../tenancy/membership.service';

/** Checks the caller's resolved Membership (set by TenantGuard) against @RequirePermissions(). Runs after TenantGuard. */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const membership: ActiveMembership | undefined = request.membership;
    if (!membership) {
      throw new ForbiddenException('No tenant membership resolved');
    }

    const missing = required.filter((p) => !membership.permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
