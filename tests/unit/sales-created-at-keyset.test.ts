import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createdAtIdCursor } from '@/hooks/createdAtIdCursor';

const id = '11111111-2222-3333-4444-555555555555';
const created_at = '2026-11-24T12:34:56.123456+00:00';

describe('sales keyset pagination', () => {
  it('keeps the full database timestamp and strictly orders equal timestamps by UUID', () => {
    expect(createdAtIdCursor({ id, created_at })).toBe(
      `created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`,
    );
  });
  it('accepts ISO UTC timestamps and rejects absent or filter-injecting values', () => {
    expect(createdAtIdCursor({ id, created_at: '2026-11-24T12:34:56Z' })).toContain('id.lt.');
    for (const row of [null, {}, { id, created_at: 'x,or(id.not.is.null)' },
      { id: 'bad', created_at }, { id, created_at: 'not-a-date' }]) {
      expect(() => createdAtIdCursor(row)).toThrow('INVALID_PAGINATION_CURSOR');
    }
  });
  it('opts sales into keyset paging and never requests an empty branch scope', () => {
    const sales = readFileSync('src/features/trade/pages/SalesPage.tsx', 'utf8');
    const hook = readFileSync('src/hooks/usePaginatedRows.ts', 'utf8');
    expect(sales).toContain('createdAtIdKeyset: true');
    expect(sales).toContain('enabled: canViewSales && !branchScope.loading && branchScope.selectedBranchIds.length > 0');
    expect(hook).toContain("q.order('created_at', { ascending: false }).order('id', { ascending: false })");
    expect(hook).toContain('q.or(createdAtIdCursor(after))');
    expect(hook).toContain('buildDataQuery(0, pageSize, rows[rows.length - 1])');
  });
});
