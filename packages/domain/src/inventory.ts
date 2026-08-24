/**
 * Pure helpers for the inventory ledger. The ledger itself (InventoryMovement)
 * lives in packages/database; these functions contain the arithmetic and
 * stock-status rules so they can be unit tested without a database and reused
 * identically by the API, background jobs, and the AI assistant's
 * deterministic KPI tool.
 */

export type StockStatus = 'red' | 'yellow' | 'green';

export interface StockStatusInput {
  availableQuantity: number;
  reorderPoint: number;
  /** Extra buffer above reorderPoint that still counts as a warning (yellow). */
  warningBuffer: number;
}

/**
 * Red: available <= 0, or available < reorderPoint.
 * Yellow: available is at or within [reorderPoint, reorderPoint + warningBuffer].
 * Green: available is safely above the warning range.
 */
export function computeStockStatus(input: StockStatusInput): StockStatus {
  const { availableQuantity, reorderPoint, warningBuffer } = input;

  if (availableQuantity <= 0 || availableQuantity < reorderPoint) {
    return 'red';
  }
  if (availableQuantity <= reorderPoint + Math.max(0, warningBuffer)) {
    return 'yellow';
  }
  return 'green';
}

export interface LedgerMovement {
  quantityDelta: number;
}

/** Replays a sequence of ledger movements into a resulting balance. Used by tests and reconciliation jobs. */
export function replayBalance(openingBalance: number, movements: LedgerMovement[]): number {
  return movements.reduce((balance, movement) => balance + movement.quantityDelta, openingBalance);
}
