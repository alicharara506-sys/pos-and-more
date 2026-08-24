/**
 * Seeds platform-level configuration only: the pricing catalog and the
 * system role/permission templates. Deliberately does NOT create any demo
 * tenant, user, product, or sale — the spec forbids hard-coded demo data in
 * production code. Onboarding (apps/api/src/onboarding) is what creates a
 * tenant's first real data.
 */
import { PrismaClient, PricingItemKind } from '@prisma/client';
import {
  DEFAULT_BASE_PRICE_USD_CENTS,
  DEFAULT_BRANCH_PRICE_USD_CENTS,
  DEFAULT_USER_PRICE_USD_CENTS,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@salesmaster/domain';

const prisma = new PrismaClient();

async function seedPricingCatalog() {
  const items = [
    {
      key: 'base',
      name: 'Base subscription',
      kind: PricingItemKind.BASE,
      unitPriceUsdCents: DEFAULT_BASE_PRICE_USD_CENTS,
    },
    {
      key: 'extra_branch',
      name: 'Additional branch',
      kind: PricingItemKind.BRANCH,
      unitPriceUsdCents: DEFAULT_BRANCH_PRICE_USD_CENTS,
    },
    {
      key: 'extra_user',
      name: 'Additional user',
      kind: PricingItemKind.USER,
      unitPriceUsdCents: DEFAULT_USER_PRICE_USD_CENTS,
    },
  ];

  for (const item of items) {
    await prisma.pricingCatalogItem.upsert({
      where: { key: item.key },
      create: item,
      update: { name: item.name, unitPriceUsdCents: item.unitPriceUsdCents, kind: item.kind },
    });
  }
  console.log(`Seeded ${items.length} pricing catalog items.`);
}

async function seedSystemRoles() {
  for (const [roleKey, permissionKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    // Prisma rejects `null` inside a compound-unique `where`, so system
    // roles (tenantId: null) must be looked up with findFirst rather than
    // upsert on the (tenantId, key) compound key.
    const existing = await prisma.role.findFirst({ where: { tenantId: null, key: roleKey } });
    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data: { name: roleLabel(roleKey) } })
      : await prisma.role.create({
          data: { tenantId: null, key: roleKey, name: roleLabel(roleKey), isSystem: true },
        });

    for (const permissionKey of permissionKeys) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: role.id, permissionKey } },
        create: { roleId: role.id, permissionKey, allowed: true },
        update: { allowed: true },
      });
    }
  }
  console.log(`Seeded ${Object.keys(DEFAULT_ROLE_PERMISSIONS).length} system roles.`);
}

function roleLabel(key: string): string {
  switch (key) {
    case SYSTEM_ROLES.OWNER:
      return 'Owner';
    case SYSTEM_ROLES.MANAGER:
      return 'Manager';
    case SYSTEM_ROLES.CASHIER:
      return 'Cashier';
    case SYSTEM_ROLES.INVENTORY_CLERK:
      return 'Inventory Clerk';
    case SYSTEM_ROLES.VIEWER:
      return 'Viewer / Accountant';
    default:
      return key;
  }
}

async function main() {
  await seedPricingCatalog();
  await seedSystemRoles();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
