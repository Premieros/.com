import { describe, expect, it } from 'vitest';
import { hasValidOfflineSaleItems } from '@/features/pos/utils/offlineSaleItemGuard';

describe('offline sale capture item guard', () => {
  it('accepts legitimate multiple lines and fractional quantities', () => {
    expect(hasValidOfflineSaleItems([
      { product_id: 'product-1', quantity: 2 },
      { product_id: 'product-2', quantity: 0.25 },
    ])).toBe(true);
  });

  it('refuses missing, empty, or corrupt item collections', () => {
    expect(hasValidOfflineSaleItems(null)).toBe(false);
    expect(hasValidOfflineSaleItems(undefined)).toBe(false);
    expect(hasValidOfflineSaleItems([])).toBe(false);
    expect(hasValidOfflineSaleItems([null] as never)).toBe(false);
    expect(hasValidOfflineSaleItems([{ product_id: '', quantity: 2 }])).toBe(false);
  });

  it('refuses malformed quantities even if negative stock is permitted', () => {
    for (const quantity of [0, -1, NaN, Infinity, -Infinity, null, '', '2', true, undefined]) {
      expect(hasValidOfflineSaleItems([
        { product_id: 'product-1', quantity: 2 },
        { product_id: 'product-2', quantity },
      ])).toBe(false);
    }
  });
});
