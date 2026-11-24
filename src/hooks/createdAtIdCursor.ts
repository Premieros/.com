/** A stable keyset boundary for rows ordered by created_at DESC, id DESC.
 * Preserve the server timestamp verbatim (including sub-millisecond precision).
 * Reject malformed values rather than silently falling back to an unsafe offset.
 */
export function createdAtIdCursor(row: unknown): string {
  const { created_at, id } = (row ?? {}) as { created_at?: unknown; id?: unknown };
  if (typeof created_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(created_at)
    || !Number.isFinite(Date.parse(created_at))
    || typeof id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('INVALID_PAGINATION_CURSOR');
  }
  return `created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`;
}
