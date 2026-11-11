import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkSourceSale, sourceSaleId } from '@/features/reporting/reportSourceLinks';
import { filterAndSortReportRows, paginateReportRows } from '@/features/reporting/reportTablePresentation';

describe('report → source sale navigation', () => {
  const realId = '8cb827cb-2ecb-4445-98a7-a6ec4df404de';

  it('keeps exact source id out of visible columns and all export projections', () => {
    const row = linkSourceSale({ Invoice: 'INV-0008', Total: 75 }, realId);
    expect(sourceSaleId(row)).toBe(realId);
    expect(Object.keys(row)).toEqual(['Invoice', 'Total']);
    expect(JSON.stringify(row)).not.toContain(realId);
    const sorted = filterAndSortReportRows([row], '', 'Total', 'desc');
    expect(sourceSaleId(sorted[0])).toBe(realId);
    expect(sourceSaleId(paginateReportRows(sorted, 1, 25).rows[0])).toBe(realId);
  });

  it('rejects untrusted or malformed identifiers without adding source links', () => {
    const row = linkSourceSale({ Invoice: 'INV-OTHER' }, 'not-a-uuid');
    expect(sourceSaleId(row)).toBeNull();
    expect(sourceSaleId(linkSourceSale({ Invoice: 'INV-OTHER' }, null))).toBeNull();
    expect(sourceSaleId(linkSourceSale({ Invoice: 'INV-OTHER' }, 12))).toBeNull();
  });

  it('only targets the existing sales page and requires current sales/branch permissions', () => {
    const report = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');
    const sales = readFileSync(resolve(process.cwd(), 'src/features/trade/pages/SalesPage.tsx'), 'utf8');
    expect(report).toContain("can('sales.view')");
    expect(report).toContain("APP_ROUTES.sales}?saleId=");
    expect(report).toContain('linkSourceSale(withBranch(sale.branch_id');
    expect(sales).toContain("can('sales.view')");
    expect(sales).toContain(".in('branch_id', branchScope.selectedBranchIds)");
    expect(sales).toContain(".eq('id', requestedSaleId)");
    expect(sales).toContain(".eq('is_archived', false)");
    expect(sales).toContain(".maybeSingle()");
    expect(sales).toContain("setSourceLookup('unavailable')");
  });
});
