/**
 * Presentation-only operations on rows already returned by Premier's existing,
 * authorized report loaders. Never use these rows to recalculate financial KPIs.
 */
export type ReportSortDirection = 'asc' | 'desc';

export function filterAndSortReportRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  search: string,
  sortKey: string | null,
  direction: ReportSortDirection,
): Record<string, unknown>[] {
  const term = search.trim().toLocaleLowerCase();
  const searched = term.length === 0
    ? [...rows]
    : rows.filter((row) => Object.values(row).some((value) =>
        value !== null && value !== undefined
        && String(value).toLocaleLowerCase().includes(term),
      ));

  if (!sortKey) return searched;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sortable = searched.map((row, originalIndex) => ({ row, originalIndex }));
  sortable.sort((a, b) => {
    const left = a.row[sortKey];
    const right = b.row[sortKey];
    // Missing values are last in both directions, never silently treated as zero.
    if (left === null || left === undefined || left === '') {
      if (right === null || right === undefined || right === '') return a.originalIndex - b.originalIndex;
      return 1;
    }
    if (right === null || right === undefined || right === '') return -1;
    const bothNumeric = typeof left === 'number' && Number.isFinite(left)
      && typeof right === 'number' && Number.isFinite(right);
    const compare = bothNumeric
      ? left - right
      : collator.compare(String(left), String(right));
    return (direction === 'asc' ? compare : -compare) || a.originalIndex - b.originalIndex;
  });
  return sortable.map(({ row }) => row);
}

export function paginateReportRows<T>(rows: ReadonlyArray<T>, requestedPage: number, pageSize: number) {
  const safeSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 25;
  const totalPages = Math.max(1, Math.ceil(rows.length / safeSize));
  const page = Number.isFinite(requestedPage)
    ? Math.min(totalPages, Math.max(1, Math.floor(requestedPage)))
    : 1;
  return {
    rows: rows.slice((page - 1) * safeSize, page * safeSize),
    page,
    totalPages,
    total: rows.length,
    first: rows.length === 0 ? 0 : (page - 1) * safeSize + 1,
    last: Math.min(page * safeSize, rows.length),
  };
}
