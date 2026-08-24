import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@salesmaster/domain';

export const PERMISSIONS_KEY = 'requiredPermissions';

/** Declares the permission(s) a route requires. Enforced by RbacGuard against the caller's Membership/Role. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
