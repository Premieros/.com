import { describe, expect, it } from 'vitest';
import { recipeCostBreakdown } from '../../src/features/catalog/recipeCostBreakdown';

describe('recipe default-cost line breakdown', () => {
  const priced = [{ id: 'flour', default_cost: 10 }, { id: 'oil', default_cost: 6 }];
  it('calculates individual raw lines including wastage and projected ratio', () => {
    const data = recipeCostBreakdown([
      { raw_material_id: 'flour', quantity: 2, wastage_percent: 10 },
      { raw_material_id: 'oil', quantity: 1, wastage_percent: 0 },
    ], priced, 0, 50);
    expect(data.lines.map(line => line.extendedCost)).toEqual([22, 6]);
    expect(data).toMatchObject({
      knownSubtotal: 28, complete: true, incompleteLines: 0,
      projectedCostRatio: 56, projectedGrossMargin: 44,
    });
  });
  it('never represents missing raw prices as zero-cost margin', () => {
    const data = recipeCostBreakdown([
      { raw_material_id: 'flour', quantity: 2, wastage_percent: 10 },
      { raw_material_id: 'missing', quantity: 1, wastage_percent: 0 },
    ], priced, 0, 100);
    expect(data.knownSubtotal).toBe(22);
    expect(data.lines[1].extendedCost).toBeNull();
    expect(data.complete).toBe(false);
    expect(data.projectedCostRatio).toBeNull();
    expect(data.projectedGrossMargin).toBeNull();
  });
  it('excludes manufactured groups from fake complete recipe costs', () => {
    const data = recipeCostBreakdown([{ raw_material_id: 'flour', quantity: 1, wastage_percent: 0 }], priced, 2, 100);
    expect(data.excludedGroups).toBe(2);
    expect(data.complete).toBe(false);
    expect(data.projectedGrossMargin).toBeNull();
  });
  it('rejects invalid quantities and zero selling price for ratio calculations', () => {
    const bad = recipeCostBreakdown([{ raw_material_id: 'flour', quantity: -1, wastage_percent: 0 }], priced, 0, 100);
    expect(bad.lines[0].valid).toBe(false);
    expect(bad.knownSubtotal).toBe(0);
    expect(bad.projectedCostRatio).toBeNull();
    expect(recipeCostBreakdown([{ raw_material_id: 'flour', quantity: 1, wastage_percent: 0 }], priced, 0, 0).projectedGrossMargin).toBeNull();
  });
});
