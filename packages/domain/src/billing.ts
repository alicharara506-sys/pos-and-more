/**
 * SalesMaster Pro pricing engine.
 *
 * Exact formula (docs/billing.md):
 *   monthly_total_usd = 10
 *                      + max(0, active_branch_count - 1) * 5
 *                      + max(0, billable_user_count - 1) * 2
 *                      + selected_optional_add_ons
 *
 * All amounts are computed in integer USD cents to stay decimal-safe and
 * avoid floating point drift. The unit prices themselves are NOT hard-coded
 * here beyond the documented defaults — callers pass the current
 * PricingCatalogItem rows (see packages/database) so a platform admin can
 * repriced add-ons without a code deploy. The base/branch/user rates are the
 * one part of the model the spec fixes exactly, so they double as safe
 * defaults when no catalog override is supplied.
 */

export const DEFAULT_BASE_PRICE_USD_CENTS = 1000; // $10.00
export const DEFAULT_BRANCH_PRICE_USD_CENTS = 500; // $5.00
export const DEFAULT_USER_PRICE_USD_CENTS = 200; // $2.00

export interface AddOnSelection {
  key: string;
  name: string;
  unitPriceUsdCents: number;
  quantity: number;
}

export interface BillingCalculationInput {
  /** Total branches currently active (not archived). Must be >= 1. */
  activeBranchCount: number;
  /** Total billable (non-suspended) users. Must be >= 1 (the owner). */
  billableUserCount: number;
  /** Optional premium add-ons the tenant has selected. */
  addOns?: AddOnSelection[];
  /** Override the base/branch/user unit prices, e.g. from PricingCatalogItem. */
  basePriceUsdCents?: number;
  branchPriceUsdCents?: number;
  userPriceUsdCents?: number;
}

export interface BillingLineItem {
  key: string;
  name: string;
  quantity: number;
  unitPriceUsdCents: number;
  totalUsdCents: number;
}

export interface BillingCalculationResult {
  lineItems: BillingLineItem[];
  totalUsdCents: number;
  totalUsd: string;
}

export function calculateMonthlyBilling(input: BillingCalculationInput): BillingCalculationResult {
  const {
    activeBranchCount,
    billableUserCount,
    addOns = [],
    basePriceUsdCents = DEFAULT_BASE_PRICE_USD_CENTS,
    branchPriceUsdCents = DEFAULT_BRANCH_PRICE_USD_CENTS,
    userPriceUsdCents = DEFAULT_USER_PRICE_USD_CENTS,
  } = input;

  if (!Number.isInteger(activeBranchCount) || activeBranchCount < 1) {
    throw new Error('activeBranchCount must be an integer >= 1');
  }
  if (!Number.isInteger(billableUserCount) || billableUserCount < 1) {
    throw new Error('billableUserCount must be an integer >= 1');
  }

  const extraBranches = Math.max(0, activeBranchCount - 1);
  const extraUsers = Math.max(0, billableUserCount - 1);

  const lineItems: BillingLineItem[] = [
    {
      key: 'base',
      name: 'Base subscription (1 branch, 1 user included)',
      quantity: 1,
      unitPriceUsdCents: basePriceUsdCents,
      totalUsdCents: basePriceUsdCents,
    },
  ];

  if (extraBranches > 0) {
    lineItems.push({
      key: 'extra_branch',
      name: 'Additional branch',
      quantity: extraBranches,
      unitPriceUsdCents: branchPriceUsdCents,
      totalUsdCents: extraBranches * branchPriceUsdCents,
    });
  }

  if (extraUsers > 0) {
    lineItems.push({
      key: 'extra_user',
      name: 'Additional user',
      quantity: extraUsers,
      unitPriceUsdCents: userPriceUsdCents,
      totalUsdCents: extraUsers * userPriceUsdCents,
    });
  }

  for (const addOn of addOns) {
    if (addOn.quantity <= 0) continue;
    lineItems.push({
      key: addOn.key,
      name: addOn.name,
      quantity: addOn.quantity,
      unitPriceUsdCents: addOn.unitPriceUsdCents,
      totalUsdCents: addOn.quantity * addOn.unitPriceUsdCents,
    });
  }

  const totalUsdCents = lineItems.reduce((sum, item) => sum + item.totalUsdCents, 0);

  return {
    lineItems,
    totalUsdCents,
    totalUsd: (totalUsdCents / 100).toFixed(2),
  };
}
