import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stock = readFileSync('src/features/inventory/components/RawMaterialBranchStockPanel.tsx', 'utf8');
const reports = readFileSync('src/features/reporting/pages/ReportsCenterPage.tsx', 'utf8');

describe('backoffice inventory and reporting presentation', () => {
  it('keeps warehouse and branch stock access scoped to accessible branches', () => {
    expect(stock).toContain("const accessibleBranchIds = selectedBranchId");
    expect(stock).toContain(".in('branch_id', accessibleBranchIds)");
    expect(stock).toContain("raw_material_warehouse_inventory");
    expect(stock).toContain('selectedWarehouseId');
    expect(stock).toContain('data-testid="raw-stock-branch-select"');
  });

  it('offers genuine query and status tabs over loaded stock rows only', () => {
    expect(stock).toContain('data-testid="raw-stock-search"');
    expect(stock).toContain('data-testid="raw-stock-status-tabs"');
    expect(stock).toContain('role="tab"');
    expect(stock).toContain("stockView === 'low'");
    expect(stock).toContain("stockView === 'zero'");
    expect(stock).toContain("stockView === 'available'");
    expect(stock).toContain("row.raw_material.name");
  });

  it('preserves real reports permissions and date validation', () => {
    expect(reports).toContain('report.permissions.every');
    expect(reports).toContain('businessReportAllowed(runtime');
    expect(reports).toContain('history.clampRange');
    expect(reports).toContain('useBranchScope()');
    expect(reports).toContain('data-testid="reports-compact-toolbar"');
    expect(reports).toContain('data-testid="premier-reports-directory"');
    expect(reports).toContain('data-testid="apply-overview-dates"');
  });
});
