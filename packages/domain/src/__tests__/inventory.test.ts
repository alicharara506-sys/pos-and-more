import { describe, expect, it } from 'vitest';
import { computeStockStatus, replayBalance } from '../inventory';

describe('computeStockStatus', () => {
  it('is red when available is zero or negative', () => {
    expect(computeStockStatus({ availableQuantity: 0, reorderPoint: 5, warningBuffer: 2 })).toBe(
      'red',
    );
    expect(computeStockStatus({ availableQuantity: -3, reorderPoint: 5, warningBuffer: 2 })).toBe(
      'red',
    );
  });

  it('is red when below the reorder point', () => {
    expect(computeStockStatus({ availableQuantity: 4, reorderPoint: 5, warningBuffer: 2 })).toBe(
      'red',
    );
  });

  it('is yellow at or within the warning buffer', () => {
    expect(computeStockStatus({ availableQuantity: 5, reorderPoint: 5, warningBuffer: 2 })).toBe(
      'yellow',
    );
    expect(computeStockStatus({ availableQuantity: 7, reorderPoint: 5, warningBuffer: 2 })).toBe(
      'yellow',
    );
  });

  it('is green safely above the warning range', () => {
    expect(computeStockStatus({ availableQuantity: 8, reorderPoint: 5, warningBuffer: 2 })).toBe(
      'green',
    );
  });
});

describe('replayBalance', () => {
  it('replays ledger movements deterministically', () => {
    const balance = replayBalance(10, [
      { quantityDelta: -3 },
      { quantityDelta: 5 },
      { quantityDelta: -2 },
    ]);
    expect(balance).toBe(10);
  });
});
