import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const header = read('src/components/PageHeader.tsx');
const surface = read('src/components/design/DesignSurface.tsx');
const sales = read('src/features/trade/pages/SalesPage.tsx');
const layout = read('src/components/Layout.tsx');

describe('compact above-table page controls', () => {
  it('preserves Premier global app header dimensions and actions', () => {
    expect(layout).toContain('h-[64px]');
    expect(layout).toContain('pt-[64px]');
    expect(layout).toContain('data-testid="header-pos-shortcut"');
  });

  it('compacts the shared title, buttons and whitespace without clipping actions', () => {
    expect(header).toContain('gap-y-1.5 sm:flex-nowrap');
    expect(header).toContain('data-testid="page-header"');
    expect(header).toContain('overflow-x-auto overscroll-x-contain');
    expect(surface).toContain("'min-w-0 space-y-2'");
    expect(layout).toContain('lg:pt-3');
  });

  it('keeps invoice search visible but moves optional filters out of the above-table area', () => {
    expect(sales).toContain('data-testid="sales-search"');
    expect(sales).toContain('data-testid="sales-toggle-filters"');
    expect(sales).toContain('aria-expanded={showViewFilters}');
    expect(sales).toContain('showViewFilters && (');
    expect(sales).toContain('data-testid="sales-view-date"');
    expect(sales).toContain('data-testid="sales-table-panel"');
    expect(sales).toContain('onRowClick={openViewSale}');
    expect(sales).toContain('branch_ids: branchScope.selectedBranchIds');
  });
});
