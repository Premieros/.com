export function includePendingComponent<T>(rows: T[], selectedId: string, quantity: number, getId: (row: T) => string, create: (id: string, quantity: number) => T): T[] {
  if (!selectedId) return rows;
  if (!Number.isFinite(quantity) || quantity <= 0 || rows.some(row => getId(row) === selectedId)) throw new Error('INVALID_PENDING_COMPONENT');
  return [...rows, create(selectedId, quantity)];
}
export function assertSavedComponentRows<T extends { quantity: number }, U extends { quantity: number }>(expected: T[], actual: U[], getId: (row: T | U) => string): void {
  if (actual.length !== expected.length || expected.some(row => !actual.some(saved => getId(saved) === getId(row) && Math.abs(Number(saved.quantity) - Number(row.quantity)) < 0.000001))) throw new Error('COMPONENTS_NOT_SAVED');
}
