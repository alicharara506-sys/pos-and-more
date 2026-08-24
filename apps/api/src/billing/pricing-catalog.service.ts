import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_BASE_PRICE_USD_CENTS,
  DEFAULT_BRANCH_PRICE_USD_CENTS,
  DEFAULT_USER_PRICE_USD_CENTS,
} from '@salesmaster/domain';
import { PricingItemKind } from '@salesmaster/database';

export interface ResolvedPricingCatalog {
  basePriceUsdCents: number;
  branchPriceUsdCents: number;
  userPriceUsdCents: number;
  addOns: Array<{
    key: string;
    name: string;
    unitPriceUsdCents: number;
    stripePriceId: string | null;
  }>;
}

/**
 * Reads the versioned pricing catalog (seeded defaults: $10 / $5 / $2 — see
 * docs/billing.md) so a platform admin can reprice add-ons without a
 * deploy. Falls back to the spec's hard defaults only if the catalog table
 * is unexpectedly empty (e.g. a fresh DB before seeding ran).
 */
@Injectable()
export class PricingCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(): Promise<ResolvedPricingCatalog> {
    const items = await this.prisma.client.pricingCatalogItem.findMany({
      where: { isActive: true },
    });

    const base = items.find((i) => i.kind === PricingItemKind.BASE);
    const branch = items.find((i) => i.kind === PricingItemKind.BRANCH);
    const user = items.find((i) => i.kind === PricingItemKind.USER);
    const addOns = items.filter((i) => i.kind === PricingItemKind.ADDON);

    return {
      basePriceUsdCents: base?.unitPriceUsdCents ?? DEFAULT_BASE_PRICE_USD_CENTS,
      branchPriceUsdCents: branch?.unitPriceUsdCents ?? DEFAULT_BRANCH_PRICE_USD_CENTS,
      userPriceUsdCents: user?.unitPriceUsdCents ?? DEFAULT_USER_PRICE_USD_CENTS,
      addOns: addOns.map((a) => ({
        key: a.key,
        name: a.name,
        unitPriceUsdCents: a.unitPriceUsdCents,
        stripePriceId: a.stripePriceId,
      })),
    };
  }
}
