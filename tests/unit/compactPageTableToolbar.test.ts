import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const header = read('src/components/PageHeader.tsx');
const surface = read('src/components/design/DesignSurface.tsx');
const sales = read('src/features/trade/pages/SalesPage.tsx');
const layout = read('src/components/Layout.tsx');
const dataTable = read('src/components/DataTable.tsx');

describe('compact above-table page controls', () => {
  it('preserves Premier global app header dimensions and actions', () => {
    expect(layout).toContain('h-[68px]');
    expect(layout).toContain('pt-[68px]');
    expect(layout).toContain('data-testid="header-pos-shortcut"');
  });

  it('compacts the shared title, buttons and whitespace without clipping actions', () => {
    expect(header).toContain('sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)]');
    expect(header).toContain('data-testid="page-header"');
    expect(header).toContain('sm:overflow-x-auto sm:overscroll-x-contain');
    expect(surface).toContain("'min-w-0 space-y-2'");
    expect(layout).toContain('workspace-toolbar sticky');
    expect(header).toContain('className="sr-only"');
  });

  it('scrolls rows inside a bounded table while keeping bold column labels and the footer visible', () => {
    expect(dataTable).toContain('data-testid="data-table-scroll"');
    expect(dataTable).toContain('overflow-auto overscroll-contain');
    expect(dataTable).toContain('data-table-viewport');
    expect(dataTable).toContain('<tfoot className="sticky bottom-0');
    expect(dataTable).toContain('sticky top-0 z-20');
    expect(dataTable).toContain('font-extrabold uppercase');
    expect(dataTable).toContain('data-testid="data-table-footer"');
    expect(dataTable).toContain('renderOpenFilterPanel()');
    expect(dataTable).toContain('data-testid="data-table-filter-menu"');
    expect(dataTable).toContain('setOpenFilterKey');
    expect(dataTable).toContain('displayData.reduce((acc, row)');
    expect(dataTable).toContain('displayData.length');
    expect(sales).toContain("key: 'total'");
    expect(sales).toContain("key: 'paid_amount'");
    expect(sales).toContain('branch_ids: branchScope.selectedBranchIds');
  });

  it('keeps invoice search visible but moves optional filters out of the above-table area', () => {
    expect(sales).toContain('data-testid="sales-search"');
    expect(sales).toContain('data-testid="sales-toggle-filters"');
    expect(sales).toContain('aria-expanded={showViewFilters}');
    expect(sales).toContain('showViewFilters && (');
    expect(sales).toContain('data-testid="sales-view-date"');
    expect(sales).toContain('testId="sales-table-panel"');
    expect(sales).toContain('onRowClick={openViewSale}');
    expect(sales).toContain('branch_ids: branchScope.selectedBranchIds');
  });
});
