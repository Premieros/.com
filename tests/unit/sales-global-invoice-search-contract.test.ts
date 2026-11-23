import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/trade/pages/SalesPage.tsx','utf8');
const paging = readFileSync('src/hooks/usePaginatedRows.ts','utf8');

describe('sales global invoice lookup contract', () => {
  it('keeps invoice search branch scoped and server-side, not unrestricted browser loading', () => {
    expect(source).toContain("searchAllInvoices ? { term: debouncedInvoiceSearch, columns: ['invoice_number'] } : undefined");
    expect(source).toContain('branch_ids: branchScope.selectedBranchIds');
    expect(source).toContain("{ column: 'is_archived', value: false }");
    expect(source).toContain('pageSize: 100');
    expect(paging).toContain('bq = bq.in(\'branch_id\', scopedBranchIds)');
    expect(paging).toContain('bq = bq.or(filter)');
  });
  it('preserves the previous loaded customer/order search mode and makes scope explicit', () => {
    expect(source).toContain("i.source_order?.order_number?.toLowerCase().includes(term)");
    expect(source).toContain("i.customer?.name?.toLowerCase().includes(term)");
    expect(source).toContain('searchAllInvoices || !search.trim() ? items : items.filter');
    expect(source).toContain('data-testid="sales-global-invoice-search"');
    expect(source).toContain("setSearchAllInvoices(event.target.checked); setSearch('');");
  });
});
