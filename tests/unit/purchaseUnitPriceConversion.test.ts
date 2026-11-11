import { describe, expect, it } from 'vitest';
import { convertPurchaseLineUnit, convertPurchaseUnitPrice } from '@/features/trade/services/purchasePriceUnits';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('adapted Johna purchase unit conversion for Premier', () => {
  it('converts unit prices for mass and volume labels (including Arabic aliases)', () => {
    expect(convertPurchaseUnitPrice(100, 'kg', 'جم')).toBeCloseTo(0.1);
    expect(convertPurchaseUnitPrice(0.1, 'جم', 'kg')).toBeCloseTo(100);
    expect(convertPurchaseUnitPrice(50, 'لتر', 'ml')).toBeCloseTo(0.05);
    expect(convertPurchaseUnitPrice(0.05, 'ml', 'لتر')).toBeCloseTo(50);
  });

  it('preserves physical quantity and line total when switching purchase units', () => {
    const initial = { quantity: 2, unit_cost: 100, unit_name: 'kg' };
    const inGrams = convertPurchaseLineUnit(initial, 'جم');
    expect(inGrams).toEqual({ quantity: 2000, unit_cost: 0.1, unit_name: 'جم' });
    expect(inGrams!.quantity * inGrams!.unit_cost).toBeCloseTo(initial.quantity * initial.unit_cost);
    const back = convertPurchaseLineUnit(inGrams!, 'kg');
    expect(back!.quantity).toBeCloseTo(initial.quantity);
    expect(back!.unit_cost).toBeCloseTo(initial.unit_cost);
  });

  it('refuses inappropriate conversions rather than inventing a new invoice price', () => {
    expect(convertPurchaseLineUnit({ quantity: 2, unit_cost: 10, unit_name: 'kg' }, 'liter')).toBeNull();
    expect(convertPurchaseLineUnit({ quantity: 2, unit_cost: 10, unit_name: 'pack 12' }, 'kg')).toBeNull();
    expect(convertPurchaseLineUnit({ quantity: -1, unit_cost: 10, unit_name: 'kg' }, 'جم')).toBeNull();
    expect(convertPurchaseLineUnit({ quantity: 2, unit_cost: -10, unit_name: 'kg' }, 'جم')).toBeNull();
    expect(convertPurchaseUnitPrice(Infinity, 'kg', 'g')).toBeNull();
  });

  it('keeps the change in the existing Premier purchases editor rather than writing stock', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/features/trade/pages/PurchasesPage.tsx'), 'utf8');
    expect(page).toContain('changePurchaseUnit(i, e.target.value)');
    expect(page).toContain('convertPurchaseLineUnit(line, nextUnit)');
    expect(page).toContain('purchase-unit-conversion-hint');
    expect(page).toContain('setLineItems(current =>');
    expect(page).not.toContain('convertPurchaseUnitPrice(line.unit_cost, line.unit_name, String(value)) ?? 0');
  });
});
