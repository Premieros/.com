import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { localSaleDayBounds } from '@/features/trade/saleDateFilters';

const sales = readFileSync('src/features/trade/pages/SalesPage.tsx', 'utf8');
const pagination = readFileSync('src/hooks/usePaginatedRows.ts', 'utf8');

describe('sales whole-history status and calendar-day filters', () => {
  it('turns a local day into inclusive and exclusive UTC boundaries', () => {
    const date = '2026-11-23';
    const bounds = localSaleDayBounds(date);
    expect(bounds).not.toBeNull();
    expect(bounds?.start).toBe(new Date(2026, 10, 23).toISOString());
    expect(bounds?.end).toBe(new Date(2026, 10, 24).toISOString());
  });

  it('rejects invalid dates and handles local leap days', () => {
    expect(localSaleDayBounds('2026-02-29')).toBeNull();
    expect(localSaleDayBounds('2026-13-02')).toBeNull();
    expect(localSaleDayBounds('2026-2-02')).toBeNull();
    expect(localSaleDayBounds('2024-02-29')).not.toBeNull();
  });

  it('applies state and date in PostgREST before range pagination, within authorized branches', () => {
    expect(sales).toContain('branch_ids: branchScope.selectedBranchIds');
    expect(sales).toContain("{ column: 'is_archived', value: false }");
    expect(sales).toContain("{ column: 'status', value: displayStatus }");
    expect(sales).toContain("exclude: displayStatus === 'other'");
    expect(sales).toContain("min: dateBounds ? { column: 'created_at', value: dateBounds.start }");
    expect(sales).toContain("maxExclusive: dateBounds ? { column: 'created_at', value: dateBounds.end }");
    expect(pagination).toContain("bq = bq.not(exclude.column, 'in'");
    expect(pagination).toContain('bq = bq.lt(maxExclusive.column, maxExclusive.value)');
    expect(pagination).toContain('return q.range(from, to)');
  });

  it('preserves the older loaded-page customer/source order search and the 100-row server page', () => {
    expect(sales).toContain('pageSize: 100');
    expect(sales).toContain('i.customer?.name?.toLowerCase().includes(term)');
    expect(sales).toContain('i.source_order?.order_number?.toLowerCase().includes(term)');
    expect(sales).toContain("if (key === 'today') setDisplayDate('')");
  });
});
