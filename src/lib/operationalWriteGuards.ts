/** Transport success is not business-operation success. */
export function requireSuccessfulMutation<T extends { success?: boolean; error?: string; detail?: string }>(result: { data: T | null; error?: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.success) throw new Error(result.data?.detail || result.data?.error || 'MUTATION_NOT_CONFIRMED');
  return result.data;
}
/** Blank is uncounted; zero is a legitimate physical count. */
export function parseNonnegativeQuantity(value: string): number | null {
  if (!value.trim()) return null;
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('INVALID_QUANTITY');
  return quantity;
}

/** Ignore stale async lookups without overwriting the latest draft edits. */
export function applyTransferCost<T extends { lookupToken?: number; unit_cost: number; costError?: boolean }>(rows: T[], token: number, cost: number, costError = false): T[] {
  return rows.map(row => row.lookupToken === token ? { ...row, unit_cost: cost, lookupToken: undefined, costError } : row);
}
