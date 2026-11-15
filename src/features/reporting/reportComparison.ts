/**
 * Date-only reporting comparisons. Uses UTC Gregorian calendar arithmetic,
 * independent of browser timezone. No financial data is recalculated here.
 */
export interface ComparisonPeriod { from: string; to: string }

function parseDateOnly(raw: string): Date {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) throw new Error('INVALID_COMPARISON_PERIOD');
  const date = new Date(raw + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error('INVALID_COMPARISON_PERIOD');
  }
  return date;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Previous interval of equal day count; or same dates in prior year. */
export function comparisonPeriod(current: ComparisonPeriod, mode: 'previous' | 'year'): ComparisonPeriod {
  const start = parseDateOnly(current.from);
  const end = parseDateOnly(current.to);
  if (start > end) throw new Error('INVALID_COMPARISON_PERIOD');
  if (mode === 'previous') {
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return {
      from: isoDate(new Date(start.getTime() - dayCount * 86400000)),
      to: isoDate(new Date(start.getTime() - 86400000)),
    };
  }
  const priorYear = (date: Date): string => {
    const y = date.getUTCFullYear() - 1;
    const m = date.getUTCMonth();
    const day = Math.min(date.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
    return isoDate(new Date(Date.UTC(y, m, day)));
  };
  return { from: priorYear(start), to: priorYear(end) };
}
