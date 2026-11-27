import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('POS authoritative warehouse and stock policy contract', () => {
  it('does not substitute branch-wide stock when online order warehouse cannot be resolved', () => {
    const page = read('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(page).toContain('fetchBranchWarehouseId(effectiveBranch, orderIdParam || null)');
    expect(page).toContain(".eq('warehouse_id', warehouseId)");
    expect(page).toMatch(/if \(!warehouseId\) \{[\s\S]*?navigator\.onLine[\s\S]*?setLiveStockMap\(\{\}\)/);
  });
  it('retains offline fallback while keeping the final server settlement separate', () => {
    const page = read('src/features/pos/pages/PosWorkspacePage.tsx');
    const payment = read('src/features/pos/services/payment.ts');
    expect(page).toContain('InventoryRepository.getBranchStockMap(effectiveBranch)');
    expect(payment).toContain('InventoryRepository.getEffectiveAvailableStock');
    expect(payment).toContain('INSUFFICIENT_STOCK');
  });
  it('uses the canonical signed stock source in the online POS and inventory UI', () => {
    expect(read('src/features/pos/pages/PosWorkspacePage.tsx')).toContain("from('v_current_stock_position')");
    expect(read('src/features/inventory/pages/StockBalancesPage.tsx')).toContain("allRows('v_current_stock_position'");
  });
});
