import { describe, expect, it } from 'vitest';
import { buildRawReorderLines, reorderLinesToProcurementItems, suggestRawReorderQty } from '@/lib/reorder';

describe('raw material reorder quantity', () => {
  it('covers the full negative balance when the minimum is unset', () => {
    expect(suggestRawReorderQty({ quantity: -4732, min_stock: 0 })).toBe(4732);
  });

  it('replenishes a deficit through the specified minimum', () => {
    expect(suggestRawReorderQty({ quantity: -8, min_stock: 12 })).toBe(20);
  });

  it('preserves the single-unit fallback at zero with no minimum', () => {
    expect(suggestRawReorderQty({ quantity: 0, min_stock: 0 })).toBe(1);
  });

  it('does not suggest ordering healthy stock with no minimum', () => {
    expect(suggestRawReorderQty({ quantity: 5, min_stock: 0 })).toBe(0);
  });

  it('uses the full deficit in a purchase-request suggestion', () => {
    const lines = buildRawReorderLines([{
      raw_material_id: 'raw-1',
      name: 'Sugar packs',
      unit_name: 'pack',
      quantity: -4732,
      min_stock: 0,
      default_cost: 1,
    }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ on_hand: -4732, suggested_qty: 4732 });
  });
  it('excludes non-finite and non-positive quantity overrides from purchase requests', () => {
    const lines = buildRawReorderLines([
      { raw_material_id: 'a', name: 'A', unit_name: 'kg', quantity: -3, min_stock: 0, default_cost: 10 },
      { raw_material_id: 'b', name: 'B', unit_name: 'kg', quantity: -4, min_stock: 0, default_cost: 10 },
      { raw_material_id: 'c', name: 'C', unit_name: 'kg', quantity: -5, min_stock: 0, default_cost: 10 },
      { raw_material_id: 'd', name: 'D', unit_name: 'kg', quantity: -6, min_stock: 0, default_cost: 10 },
      { raw_material_id: 'e', name: 'E', unit_name: 'kg', quantity: -7, min_stock: 0, default_cost: 10 },
    ]);
    expect(reorderLinesToProcurementItems(lines, {
      'raw:a': Number.POSITIVE_INFINITY,
      'raw:b': Number.NaN,
      'raw:c': 0,
      'raw:d': -2,
      'raw:e': 7.5,
    })).toEqual([expect.objectContaining({ raw_material_id: 'e', quantity: 7.5 })]);
  });

  it('preserves finite suggested quantities when no override is entered', () => {
    const lines = buildRawReorderLines([
      { raw_material_id: 'raw-1', name: 'Sugar', unit_name: 'kg', quantity: -9, min_stock: 0, default_cost: 2 },
    ]);
    expect(reorderLinesToProcurementItems(lines, {})).toEqual([
      expect.objectContaining({ raw_material_id: 'raw-1', quantity: 9 }),
    ]);
  });

});
