import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Guards the platform-admin surface (apps/api/src/admin). This is a
 * SEPARATE authorization path from tenant RBAC: it only checks
 * `User.isPlatformAdmin`, never a tenant Membership. Platform admin routes
 * must never be reachable via TenantGuard/RbacGuard.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.isPlatformAdmin) {
      throw new ForbiddenException('Platform administrator access required');
    }
    return true;
  }
}
