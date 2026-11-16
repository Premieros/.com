import { describe, expect, it } from 'vitest';
import { buildRawReorderLines, suggestRawReorderQty } from '@/lib/reorder';

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
});
