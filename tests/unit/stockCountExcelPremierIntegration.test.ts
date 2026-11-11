import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Premier stock-count Excel selective feature integration', () => {
  it('imports only into draft; never bypasses the existing approval flow', () => {
    const page = read('src/features/inventory/pages/StockCountsPage.tsx');
    expect(page).toContain('const importCountExcel = async');
    expect(page).toContain('setFormItems(parsed.lines)');
    expect(page).toContain('createStockCount');
    expect(page).toContain('submitStockCount');
    expect(page).toContain('approveStockCount');
    expect(page).toContain('applyStockCount');
    expect(page).not.toContain(".from('raw_material_warehouse_inventory').update");
  });

  it('checks Premier authorized branch scope, warehouse ownership and resets drafts', () => {
    const page = read('src/features/inventory/pages/StockCountsPage.tsx');
    expect(page).toContain('branchScope.selectedBranchSet.has(form.branch_id)');
    expect(page).toContain('w.id === form.warehouse_id && w.branch_id === form.branch_id');
    expect(page).toContain('setForm({ ...form, warehouse_id: e.target.value }); resetCreateLines();');
    expect(page).toContain("form.count_type === 'full'");
  });

  it('exports stock from a paged read filtered by branch and warehouse', () => {
    const service = read('src/features/inventory/services/stockCountExcelSnapshot.ts');
    expect(service).toContain('fetchAllReportRows');
    expect(service).toContain(".from('raw_material_warehouse_inventory')");
    expect(service).toContain(".eq('branch_id', branchId)");
    expect(service).toContain(".eq('warehouse_id', warehouseId)");
    expect(service).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it('adds workbook controls only inside the current Premier stock-count modal', () => {
    const page = read('src/features/inventory/pages/StockCountsPage.tsx');
    expect(page).toContain('stock-count-excel-tools');
    expect(page).toContain('stock-count-excel-input');
    expect(page).toContain('exportToExcelAdvanced');
    expect(page).toContain('importFromExcel');
  });
});
