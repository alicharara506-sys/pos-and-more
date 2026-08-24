import { describe, expect, it } from 'vitest';
import { calculateMonthlyBilling } from '../billing';

describe('calculateMonthlyBilling', () => {
  // Acceptance test #1
  it('charges exactly $10/month for one branch and one owner user', () => {
    const result = calculateMonthlyBilling({ activeBranchCount: 1, billableUserCount: 1 });
    expect(result.totalUsdCents).toBe(1000);
    expect(result.totalUsd).toBe('10.00');
  });

  // Acceptance test #2
  it('changes the subtotal by exactly $5 when a second branch is activated', () => {
    const one = calculateMonthlyBilling({ activeBranchCount: 1, billableUserCount: 1 });
    const two = calculateMonthlyBilling({ activeBranchCount: 2, billableUserCount: 1 });
    expect(two.totalUsdCents - one.totalUsdCents).toBe(500);
  });

  // Acceptance test #3
  it('changes the subtotal by exactly $2 when one additional billable user is activated', () => {
    const one = calculateMonthlyBilling({ activeBranchCount: 1, billableUserCount: 1 });
    const two = calculateMonthlyBilling({ activeBranchCount: 1, billableUserCount: 2 });
    expect(two.totalUsdCents - one.totalUsdCents).toBe(200);
  });

  it('combines branch and user add-ons additively', () => {
    const result = calculateMonthlyBilling({ activeBranchCount: 3, billableUserCount: 4 });
    // 10 + (3-1)*5 + (4-1)*2 = 10 + 10 + 6 = 26
    expect(result.totalUsdCents).toBe(2600);
  });

  it('includes optional add-ons in the total', () => {
    const result = calculateMonthlyBilling({
      activeBranchCount: 1,
      billableUserCount: 1,
      addOns: [{ key: 'ai_unlimited', name: 'Unlimited AI', unitPriceUsdCents: 900, quantity: 1 }],
    });
    expect(result.totalUsdCents).toBe(1900);
    expect(result.lineItems.map((l) => l.key)).toEqual(['base', 'ai_unlimited']);
  });

  it('ignores zero-quantity add-ons', () => {
    const result = calculateMonthlyBilling({
      activeBranchCount: 1,
      billableUserCount: 1,
      addOns: [{ key: 'ai_unlimited', name: 'Unlimited AI', unitPriceUsdCents: 900, quantity: 0 }],
    });
    expect(result.totalUsdCents).toBe(1000);
  });

  it('rejects branch/user counts below 1', () => {
    expect(() => calculateMonthlyBilling({ activeBranchCount: 0, billableUserCount: 1 })).toThrow();
    expect(() => calculateMonthlyBilling({ activeBranchCount: 1, billableUserCount: 0 })).toThrow();
  });

  it('respects catalog price overrides', () => {
    const result = calculateMonthlyBilling({
      activeBranchCount: 2,
      billableUserCount: 1,
      basePriceUsdCents: 1200,
      branchPriceUsdCents: 600,
    });
    expect(result.totalUsdCents).toBe(1800);
  });
});
