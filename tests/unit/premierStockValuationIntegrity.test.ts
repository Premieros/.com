import { describe, expect, it } from 'vitest';
import { requireStockValuationRows } from '@/features/inventory/services/requireStockValuationRows';
import type { StockValuationRow } from '@/lib/types';

const row = (changes: Partial<StockValuationRow> = {}): StockValuationRow => ({
  product_id: 'product-1',
  product_name: 'Product',
  branch_id: 'branch-a',
  warehouse_id: 'warehouse-a',
  warehouse_name: 'Warehouse',
  quantity: 2,
  unit_cost: 3.25,
  total_value: 6.5,
  barcode: null,
  sku: null,
  ...changes,
} as StockValuationRow);

describe('Premier current stock valuation integrity', () => {
  it('accepts genuinely empty scoped valuation, not a missing RPC result', () => {
    expect(requireStockValuationRows([], 'branch-a', null)).toEqual([]);
    expect(() => requireStockValuationRows(null, 'branch-a', null)).toThrow('STOCK_VALUATION_INCOMPLETE');
  });
  it('rejects a response from a different branch', () => {
    expect(() => requireStockValuationRows([row({ branch_id: 'branch-b' })], 'branch-a', null))
      .toThrow('STOCK_VALUATION_SCOPE_MISMATCH');
  });
  it('rejects rows outside the selected warehouse', () => {
    expect(() => requireStockValuationRows([row()], 'branch-a', 'warehouse-b'))
      .toThrow('STOCK_VALUATION_SCOPE_MISMATCH');
  });
  it('rejects null or invalid currency amounts but supports negative stock', () => {
    expect(() => requireStockValuationRows([row({ total_value: null as unknown as number })], 'branch-a', null))
      .toThrow('STOCK_VALUATION_INVALID_AMOUNT');
    expect(requireStockValuationRows([row({ quantity: -2, total_value: -6.5 })], 'branch-a', null)).toHaveLength(1);
  });
  it('does not recompute the RPC amount from a catalog price', () => {
    const valued = row({ quantity: 3, unit_cost: 2, total_value: 6.01 });
    expect(requireStockValuationRows([valued], 'branch-a', null)[0].total_value).toBe(6.01);
  });
});
