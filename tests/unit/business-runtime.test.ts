import { describe, expect, it } from 'vitest';
import {
  businessMenuLabel,
  businessPathAllowed,
  resolveBusinessRuntime,
} from '@/core/organizations/businessRuntime';
import { APP_ROUTES } from '@/core/navigation/routes';

describe('business runtime architecture', () => {
  it('turns tourism into a booking/service workspace instead of a POS/inventory workspace', () => {
    const runtime = resolveBusinessRuntime('tourism', {
      preset_key: 'tourism',
      capabilities: ['services', 'packages', 'bookings', 'traveler_records', 'supplier_settlement'],
      record_types: [
        { key: 'booking', ar: 'حجز', en: 'Booking', customerRequired: true, dateRangeEnabled: true, amountEnabled: true },
      ],
      runtime_fields: [],
    });

    expect(runtime.workflow).toBe('tourism_bookings');
    expect(runtime.navigation.hidden.has('pos')).toBe(true);
    expect(runtime.navigation.hidden.has('inventory-center')).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.floorPlan)).toBe(false);
    expect(businessPathAllowed(runtime, APP_ROUTES.businessRecords)).toBe(true);
    expect(runtime.dashboard.sections.has('business_records')).toBe(true);
    expect(runtime.dashboard.sections.has('inventory')).toBe(false);
    expect(businessMenuLabel(runtime, 'business-records', 'en', 'Business Records')).toBe('Bookings & Travelers');
  });

  it('keeps restaurant tables, KDS, ingredients and order workflow', () => {
    const runtime = resolveBusinessRuntime('restaurant', null);

    expect(runtime.workflow).toBe('restaurant_service');
    expect(businessPathAllowed(runtime, APP_ROUTES.floorPlan)).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.kitchenDisplay)).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.rawMaterials)).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.inventoryUnits)).toBe(true);
    expect(runtime.capabilities.has('component_groups')).toBe(true);
    expect(runtime.dashboard.sections.has('orders')).toBe(true);
    expect(runtime.terminology.item.ar).toContain('طبق');
  });

  it('makes pharmacy batch/expiry inventory centric without restaurant/manufacturing paths', () => {
    const runtime = resolveBusinessRuntime('pharmacy', null);

    expect(runtime.workflow).toBe('pharmacy_retail');
    expect(businessPathAllowed(runtime, APP_ROUTES.inventoryBatches)).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.lowStockAlerts)).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.rawMaterials)).toBe(false);
    expect(businessPathAllowed(runtime, APP_ROUTES.kitchenDisplay)).toBe(false);
    expect(runtime.terminology.item.ar).toContain('دواء');
  });

  it('uses stored organization profile overrides without hardcoding pages', () => {
    const runtime = resolveBusinessRuntime('custom', {
      preset_key: 'custom',
      terminology: {
        item: 'وحدة خاصة',
        customer: 'عضو',
        supplier: 'شريك',
        branch: 'موقع',
      },
      capabilities: ['tables'],
      runtime_fields: [
        { entity: 'product', key: 'custom_code', ar: 'كود خاص', en: 'Custom code', type: 'text' },
      ],
      record_types: [
        { key: 'membership', ar: 'عضوية', en: 'Membership', customerRequired: true },
      ],
    });

    expect(runtime.terminology.item.ar).toBe('وحدة خاصة');
    expect(runtime.capabilities.has('tables')).toBe(true);
    expect(runtime.runtimeFields[0]?.key).toBe('custom_code');
    expect(runtime.recordTypes[0]?.key).toBe('membership');
    expect(businessPathAllowed(runtime, APP_ROUTES.floorPlan)).toBe(true);
    expect(businessPathAllowed(runtime, APP_ROUTES.businessRecords)).toBe(true);
  });

  it('prevents extra business-record surfaces when a profile has no record workflow', () => {
    const runtime = resolveBusinessRuntime('retail', null);
    expect(runtime.recordTypes).toHaveLength(0);
    expect(businessPathAllowed(runtime, APP_ROUTES.businessRecords)).toBe(false);
  });
});
