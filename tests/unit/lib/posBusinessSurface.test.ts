import { describe, expect, it } from 'vitest';
import { resolveBusinessRuntime } from '@/core/organizations/businessRuntime';
import { resolvePosBusinessSurface } from '@/features/pos/businessSurface';

describe('business-aware POS surface', () => {
  it('keeps restaurant operations table and kitchen centric', () => {
    const surface = resolvePosBusinessSurface(resolveBusinessRuntime('restaurant', null));
    expect(surface.showTables).toBe(true);
    expect(surface.showKitchen).toBe(true);
    expect(surface.showDelivery).toBe(true);
    expect(surface.showRestaurantOrderControls).toBe(true);
    expect(surface.requiresShift).toBe(true);
    expect(surface.catalogLabel.en).toBe('Menu');
  });

  it('turns retail into a direct checkout without restaurant surfaces', () => {
    const surface = resolvePosBusinessSurface(resolveBusinessRuntime('retail', null));
    expect(surface.showTables).toBe(false);
    expect(surface.showKitchen).toBe(false);
    expect(surface.showActiveOrders).toBe(false);
    expect(surface.showRestaurantOrderControls).toBe(false);
    expect(surface.requiresShift).toBe(true);
    expect(surface.catalogLabel.en).toBe('Products');
  });

  it('turns pharmacy into medicine checkout without requiring a restaurant shift model', () => {
    const surface = resolvePosBusinessSurface(resolveBusinessRuntime('pharmacy', null));
    expect(surface.workflow).toBe('pharmacy_retail');
    expect(surface.showTables).toBe(false);
    expect(surface.showKitchen).toBe(false);
    expect(surface.requiresShift).toBe(false);
    expect(surface.catalogLabel.en).toBe('Medicines & items');
  });

  it('turns a car showroom into a customer-focused deal workspace', () => {
    const surface = resolvePosBusinessSurface(resolveBusinessRuntime('car_showroom', null));
    expect(surface.workflow).toBe('vehicle_sales');
    expect(surface.customerEmphasis).toBe(true);
    expect(surface.newSaleLabel.en).toBe('New deal');
    expect(surface.catalogLabel.en).toBe('Available vehicles');
    expect(surface.customerRequired).toBe(true);
  });

  it('turns food manufacturing into a sales desk without restaurant operations', () => {
    const surface = resolvePosBusinessSurface(resolveBusinessRuntime('food_manufacturing', null));
    expect(surface.workflow).toBe('manufacturing');
    expect(surface.customerEmphasis).toBe(true);
    expect(surface.showTables).toBe(false);
    expect(surface.showKitchen).toBe(false);
    expect(surface.requiresShift).toBe(false);
    expect(surface.newSaleLabel.en).toBe('New sales invoice');
  });
});
