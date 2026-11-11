import { describe, expect, it } from 'vitest';
import { filterAndSortReportRows, paginateReportRows } from '@/features/reporting/reportTablePresentation';

const fixture: Array<Record<string, unknown>> = [
  { invoice: 'INV-10', amount: 120.5, customer: 'محمد', note: null },
  { invoice: 'INV-2', amount: -15.25, customer: 'Sara', note: null },
  { invoice: 'INV-3', amount: 5, customer: 'Ahmed', note: 'partial' },
];

describe('authorized report row presentation', () => {
  it('does not change the original ordered rows or recompute report totals', () => {
    const rows = filterAndSortReportRows(fixture, '', 'amount', 'asc');
    expect(rows.map((row) => row.amount)).toEqual([-15.25, 5, 120.5]);
    expect(fixture.map((row) => row.invoice)).toEqual(['INV-10', 'INV-2', 'INV-3']);
  });

  it('searches already fetched rows, retaining negative and partial refund values', () => {
    expect(filterAndSortReportRows(fixture, 'sara', null, 'asc').map((row) => row.amount)).toEqual([-15.25]);
    expect(filterAndSortReportRows(fixture, 'محمد', null, 'asc')).toHaveLength(1);
    expect(filterAndSortReportRows(fixture, 'partial', null, 'asc')).toHaveLength(1);
    expect(filterAndSortReportRows(fixture, 'missing', null, 'asc')).toHaveLength(0);
  });

  it('uses natural invoice ordering and keeps absent values last in either direction', () => {
    expect(filterAndSortReportRows(fixture, '', 'invoice', 'asc').map((row) => row.invoice))
      .toEqual(['INV-2', 'INV-3', 'INV-10']);
    expect(filterAndSortReportRows(fixture, '', 'invoice', 'desc').map((row) => row.invoice))
      .toEqual(['INV-10', 'INV-3', 'INV-2']);
    const withMissing = [{ x: null }, { x: 8 }, { x: 3 }];
    expect(filterAndSortReportRows(withMissing, '', 'x', 'desc').map((row) => row.x)).toEqual([8, 3, null]);
  });

  it('pages only presentation rows and clamps stale/out-of-range page indices', () => {
    expect(paginateReportRows(fixture, 2, 2)).toMatchObject({
      total: 3, totalPages: 2, page: 2, first: 3, last: 3, rows: [fixture[2]],
    });
    expect(paginateReportRows(fixture, 200, 2).page).toBe(2);
    expect(paginateReportRows([], 12, 0)).toMatchObject({
      total: 0, totalPages: 1, page: 1, first: 0, last: 0,
    });
  });
});
