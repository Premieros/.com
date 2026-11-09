import type { StockValuationRow } from '@/lib/types';

/**
 * The stock valuation RPC is a current-price DISPLAY report, never an
 * historical COGS/journal repricing. Reject partial, cross-branch or invalid
 * responses rather than showing a plausible but incorrect monetary total.
 */
export function requireStockValuationRows(
  data: StockValuationRow[] | null,
  branchId: string,
  warehouseId: string | null,
): StockValuationRow[] {
  if (!branchId || !Array.isArray(data)) throw new Error('STOCK_VALUATION_INCOMPLETE');
  for (const row of data) {
    if (row.branch_id !== branchId || (warehouseId && row.warehouse_id !== warehouseId)) {
      throw new Error('STOCK_VALUATION_SCOPE_MISMATCH');
    }
    if (![row.quantity, row.unit_cost, row.total_value].every((value) =>
      value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    )) {
      throw new Error('STOCK_VALUATION_INVALID_AMOUNT');
    }
  }
  return data;
}
