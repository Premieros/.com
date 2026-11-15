import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/costing/pages/CostingCenterPage.tsx','utf8');

describe('Costing Center — explicit zero is an approved cost, not an absent value', () => {
  it('does not fall through to a stale nonzero cost for zero-margin and food-cost computations', () => {
    expect(source).not.toMatch(/actual_cost\s*\|\|\s*(?:r\.|acc\.|detail\.)?theoretical_cost/);
    expect(source).toContain('actual_cost ?? r.theoretical_cost ?? r.unit_cost');
    expect(source).toContain('detail.actual_cost ?? detail.theoretical_cost ?? detail.unit_cost');
  });
  it('explains approved zero pricing and shows a missing-approved-price source explicitly', () => {
    expect(source).toContain("source === 'no_published_price'");
    expect(source).toContain('لا يوجد سعر معتمد');
    expect(source).toContain('latest approved price, including zero');
    expect(source).not.toContain('Actual cost uses positive stock and settled FIFO only');
  });
});
