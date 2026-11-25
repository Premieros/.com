/**
 * Convert the operator's local calendar date to an inclusive UTC start and
 * exclusive UTC end. Local midnight boundaries preserve DST days (23/25 hours)
 * without losing the last second of a day.
 */
export function localSaleDayBounds(day: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(year, month - 1, date);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== date) return null;
  const end = new Date(year, month - 1, date + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
