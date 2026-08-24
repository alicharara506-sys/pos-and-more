/**
 * Canonical permission catalog + default role → permission mappings.
 * Seeded into Role/RolePermission by packages/database/prisma/seed.ts and
 * enforced by the API's RBAC guard (apps/api/src/auth/rbac.guard.ts).
 *
 * Owners can grant/revoke individual keys per membership beyond these
 * defaults (section 2 of the spec: "granular permissions beneath default
 * roles").
 */

export const PERMISSIONS = {
  // Sales / POS
  SALES_CREATE: 'sales.create',
  SALES_VIEW: 'sales.view',
  SALES_REFUND: 'sales.refund',
  SALES_DISCOUNT_OVERRIDE: 'sales.discount_override',
  SALES_VOID: 'sales.void',
  // Inventory
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_COST_PRICE_VIEW: 'inventory.cost_price.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',
  // Products
  PRODUCTS_MANAGE: 'products.manage',
  // Customers
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  // Invoices / quotes
  INVOICES_MANAGE: 'invoices.manage',
  QUOTES_MANAGE: 'quotes.manage',
  // Expenses
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_MANAGE: 'expenses.manage',
  EXPENSES_APPROVE: 'expenses.approve',
  // Reports
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  // Branches / org
  BRANCHES_MANAGE: 'branches.manage',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  // Billing & integrations
  BILLING_MANAGE: 'billing.manage',
  INTEGRATIONS_MANAGE: 'integrations.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS);

export const SYSTEM_ROLES = {
  OWNER: 'owner',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  INVENTORY_CLERK: 'inventory_clerk',
  VIEWER: 'viewer',
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Default permission grants per system role. Owner implicitly has all permissions. */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionKey[]> = {
  [SYSTEM_ROLES.OWNER]: ALL_PERMISSION_KEYS,
  [SYSTEM_ROLES.MANAGER]: [
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.SALES_REFUND,
    PERMISSIONS.SALES_DISCOUNT_OVERRIDE,
    PERMISSIONS.SALES_VOID,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_COST_PRICE_VIEW,
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.INVENTORY_TRANSFER,
    PERMISSIONS.PRODUCTS_MANAGE,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.INVOICES_MANAGE,
    PERMISSIONS.QUOTES_MANAGE,
    PERMISSIONS.EXPENSES_VIEW,
    PERMISSIONS.EXPENSES_MANAGE,
    PERMISSIONS.EXPENSES_APPROVE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_MANAGE,
  ],
  [SYSTEM_ROLES.CASHIER]: [
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.QUOTES_MANAGE,
  ],
  [SYSTEM_ROLES.INVENTORY_CLERK]: [
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_COST_PRICE_VIEW,
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.INVENTORY_TRANSFER,
    PERMISSIONS.PRODUCTS_MANAGE,
  ],
  [SYSTEM_ROLES.VIEWER]: [
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.EXPENSES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],
};

/** True if `granted` (a set of permission keys) satisfies `required`. */
export function hasPermission(granted: ReadonlySet<string>, required: PermissionKey): boolean {
  return granted.has(required);
}
