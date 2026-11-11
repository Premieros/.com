/**
 * Attach a source document locator without putting implementation-only ids in
 * visible table columns or CSV/XLSX/print exports (which use Object.keys).
 * This is navigation metadata, NOT an alternative accounting/reporting source.
 */
const SOURCE_SALE_ID = Symbol('premier.report.sourceSaleId');

export type SourceLinkedRow = Record<string, unknown> & {
  [SOURCE_SALE_ID]?: string;
};

export function linkSourceSale<T extends Record<string, unknown>>(
  row: T,
  saleId: unknown,
): T {
  if (typeof saleId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(saleId)) {
    return row;
  }
  Object.defineProperty(row, SOURCE_SALE_ID, {
    value: saleId,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return row;
}

export function sourceSaleId(row: Record<string, unknown>): string | null {
  return (row as SourceLinkedRow)[SOURCE_SALE_ID] ?? null;
}
