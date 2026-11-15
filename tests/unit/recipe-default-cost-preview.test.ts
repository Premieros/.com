import { describe, expect, it } from 'vitest';
import { estimateRawRecipeDefaultCost } from '../../src/features/catalog/recipeDefaultCostPreview';

describe('raw-material default-cost preview', () => {
  it('includes quantities and recipe waste without changing accounting', () => {
    expect(estimateRawRecipeDefaultCost(
      [{ raw_material_id: 'flour', quantity: 2, wastage_percent: 10 }],
      [{ id: 'flour', default_cost: 12 }],
      0,
    )).toEqual({ subtotal: 26.4, complete: true, missingPrices: 0, includesGroups: false });
  });

  it('does not treat unpriced materials or grouped composition as complete', () => {
    expect(estimateRawRecipeDefaultCost(
      [{ raw_material_id: 'missing', quantity: 1, wastage_percent: 0 }],
      [{ id: 'missing', default_cost: null }],
      2,
    )).toEqual({ subtotal: 0, complete: false, missingPrices: 1, includesGroups: true });
  });

  it('rejects invalid input quantities instead of reporting a complete estimate', () => {
    expect(estimateRawRecipeDefaultCost(
      [{ raw_material_id: 'a', quantity: -1, wastage_percent: 0 }],
      [{ id: 'a', default_cost: 5 }],
      0,
    ).complete).toBe(false);
    expect(estimateRawRecipeDefaultCost([], [], 0).complete).toBe(false);
  });
});
