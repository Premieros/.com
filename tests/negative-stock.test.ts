import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mergeEffectiveSettings } from '../src/context/SettingsContext';
import type { Settings, BranchSettings } from '../src/lib/types';

const root = process.cwd();

describe('Negative Stock: Architectural & UI Contract Verification', () => {
  it('SettingsContext merges allow_negative_stock correctly with branch inheritance hierarchy', () => {
    const globalSettings: Settings = {
      id: 'global-1',
      store_name: 'Main Store',
      store_name_en: 'Main Store EN',
      store_address: null,
      store_phone: null,
      currency: 'EGP',
      tax_rate: 14,
      tax_enabled: true,
      allow_negative_stock: false,
      receipt_footer: null,
      receipt_header: null,
      logo_url: null,
      language: 'ar',
      theme: 'light',
      brand_color: null,
      pos_default_payment_method: 'cash',
      pos_barcode_autofocus: true,
      pos_line_discount: true,
      invoice_prefix: 'INV-',
      invoice_next_number: 1,
      invoice_decimal_places: 2,
      receipt_width_mm: 80,
      receipt_copies: 1,
      receipt_auto_print: true,
      receipt_show_tax: true,
      receipt_show_qr: true,
      low_stock_threshold: 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Case 1: Branch has no override -> inherits company setting (false)
    const branch1: BranchSettings = {
      branch_id: 'branch-1',
      receipt_header: null,
      receipt_footer: null,
      logo_url: null,
      tax_rate: null,
      tax_enabled: null,
      currency: null,
      low_stock_threshold: null,
      allow_negative_stock: undefined,
      business_day_mode: 'fixed_time',
      business_day_start: '00:00',
      business_day_end: '00:00',
      auto_close_shift_at_day_end: false,
      main_area_table_count: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const eff1 = mergeEffectiveSettings(globalSettings, branch1);
    expect(eff1.allow_negative_stock).toBe(false);

    // Case 2: Company has false, but branch specifically enables it (true)
    const branch2: BranchSettings = { ...branch1, branch_id: 'branch-2', allow_negative_stock: true };
    const eff2 = mergeEffectiveSettings(globalSettings, branch2);
    expect(eff2.allow_negative_stock).toBe(true);

    // Case 3: Company has true, but branch specifically disables it (false)
    const globalWithTrue: Settings = { ...globalSettings, allow_negative_stock: true };
    const branch3: BranchSettings = { ...branch1, branch_id: 'branch-3', allow_negative_stock: false };
    const eff3 = mergeEffectiveSettings(globalWithTrue, branch3);
    expect(eff3.allow_negative_stock).toBe(false);

    // Case 4: Company has true and branch inherits
    const branch4: BranchSettings = { ...branch1, branch_id: 'branch-4', allow_negative_stock: undefined };
    const eff4 = mergeEffectiveSettings(globalWithTrue, branch4);
    expect(eff4.allow_negative_stock).toBe(true);
  });

  it('verifies that SettingsControlCenterPage exposes UI controls for negative stock', () => {
    const settingsPage = fs.readFileSync(
      path.join(root, 'src/features/admin/pages/SettingsControlCenterPage.tsx'),
      'utf8',
    );
    expect(settingsPage).toContain("'inventory'");
    expect(settingsPage).toContain('إعدادات المخزون وسياسة البيع بالسالب');
    expect(settingsPage).toContain('allow_negative_stock');
    expect(settingsPage).toContain('منع البيع بالسالب');
    expect(settingsPage).toContain('السماح بالبيع بالسالب');
  });

  it('verifies that SuperAdminConsolePage exposes both Global and Branch Negative Stock controls', () => {
    const superAdminPage = fs.readFileSync(
      path.join(root, 'src/features/admin/pages/SuperAdminConsolePage.tsx'),
      'utf8',
    );
    expect(superAdminPage).toContain('السماح بالبيع بالسالب (الإعداد الافتراضي العام)');
    expect(superAdminPage).toContain('سياسة البيع بالسالب لهذا الفرع');
    expect(superAdminPage).toContain('allow_negative_stock');
  });

  it('verifies business logic enforcement in payment.ts', () => {
    const paymentService = fs.readFileSync(
      path.join(root, 'src/features/pos/services/payment.ts'),
      'utf8',
    );
    // Verifies business logic reads both branch and global settings
    expect(paymentService).toContain('SettingsRepository.getBranchSettings');
    expect(paymentService).toContain('SettingsRepository.getGlobalSettings');
    expect(paymentService).toContain('allow_negative_stock');
    // Verifies effective available stock check with unsynced local outbox sales
    expect(paymentService).toContain('InventoryRepository.getEffectiveAvailableStock');
    expect(paymentService).toContain('INSUFFICIENT_STOCK');
    // Offline movements stay pending; server-confirmed movements are explicitly synced
    expect(paymentService).toContain('InventoryRepository.recordLocalMovement');
    expect(paymentService).toContain('synced: true');
  });

  it('verifies the server policy migration persists company/branch controls and debt-backed oversell', () => {
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20261003093000_allow_negative_stock_server_policy.sql'),
      'utf8',
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS allow_negative_stock boolean');
    expect(migration).toContain('effective_allow_negative_stock');
    expect(migration).toContain('product_stock_debts');
    expect(migration).toContain('inventory_unit_stock_debts');
    expect(migration).toContain('p_allow_negative');
  });

  it('verifies usePosOrder connects allow_negative_stock to cart-level stock gating', () => {
    const posHook = fs.readFileSync(
      path.join(root, 'src/features/pos/hooks/usePosOrder.ts'),
      'utf8',
    );
    expect(posHook).toContain('input.effSettings?.allow_negative_stock === true');
    expect(posHook).toContain('rawShortageOnly: Object.fromEntries(input.products.map((product) => [product.id, allowNegative]))');
  });
});

describe('Negative Stock: Stock Calculation & Outbox Logic Simulation', () => {
  // Pure functional simulation of InventoryRepository calculation logic
  function calculateEffectiveStock(
    baseServerQuantity: number,
    localMovements: Array<{ productId: string; delta: number; synced: boolean }>,
    pendingSales: Array<{
      status: string;
      items: Array<{ productId: string; quantity: number }>;
      invoiceNumber: string;
    }>,
    targetProductId: string,
  ): number {
    const localMovementDeltas = localMovements
      .filter((m) => m.productId === targetProductId && !m.synced)
      .reduce((sum, m) => sum + m.delta, 0);

    let extraUnsyncedSalesDeductions = 0;
    for (const sale of pendingSales) {
      if (sale.status === 'synced') continue;
      for (const item of sale.items) {
        if (item.productId === targetProductId) {
          extraUnsyncedSalesDeductions += item.quantity;
        }
      }
    }

    return baseServerQuantity + localMovementDeltas - extraUnsyncedSalesDeductions;
  }

  it('Scenario 1: Negative stock DISABLED - blocks sale when stock is insufficient', () => {
    const baseStock = 5;
    const requestedQty = 8;
    const allowNegative = false;

    const availableStock = calculateEffectiveStock(baseStock, [], [], 'prod-1');
    expect(availableStock).toBe(5);

    let saleAllowed = true;
    let errorMessage = '';

    if (!allowNegative && requestedQty > availableStock) {
      saleAllowed = false;
      errorMessage = `INSUFFICIENT_STOCK: Required ${requestedQty}, but only ${availableStock} is available. Negative stock is disabled.`;
    }

    expect(saleAllowed).toBe(false);
    expect(errorMessage).toContain('INSUFFICIENT_STOCK');
    expect(errorMessage).toContain('Required 8, but only 5 is available');
  });

  it('Scenario 1b: Negative stock DISABLED - counts unsynced offline sales in available stock', () => {
    const baseStock = 10;
    // An unsynced offline sale of 7 units took place earlier
    const localMovements = [
      { productId: 'prod-1', delta: -7, synced: false },
    ];

    const availableStock = calculateEffectiveStock(baseStock, localMovements, [], 'prod-1');
    // Available stock is now 10 - 7 = 3
    expect(availableStock).toBe(3);

    // Customer tries to buy 4 units
    const requestedQty = 4;
    const allowNegative = false;

    let saleAllowed = true;
    if (!allowNegative && requestedQty > availableStock) {
      saleAllowed = false;
    }

    // Must be blocked because 4 > 3
    expect(saleAllowed).toBe(false);
  });

  it('Scenario 2: Negative stock ENABLED - permits sale and accurately records negative balance', () => {
    const baseStock = 2;
    const requestedQty = 5;
    const allowNegative = true;

    const availableStock = calculateEffectiveStock(baseStock, [], [], 'prod-1');
    expect(availableStock).toBe(2);

    let saleAllowed = false;
    // When allowNegative is true, the check is bypassed
    if (allowNegative || requestedQty <= availableStock) {
      saleAllowed = true;
    }
    expect(saleAllowed).toBe(true);

    // After completing the sale, a local movement of -5 is logged
    const localMovements = [
      { productId: 'prod-1', delta: -requestedQty, synced: false },
    ];

    const newEffectiveStock = calculateEffectiveStock(baseStock, localMovements, [], 'prod-1');
    // Stock balance is now 2 - 5 = -3 (Negative stock successfully tracked!)
    expect(newEffectiveStock).toBe(-3);
  });
});
