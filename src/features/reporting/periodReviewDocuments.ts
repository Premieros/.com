import type { ReportType } from './reportFilters';

/** Existing document and movement report types; no new data source. */
export const PERIOD_REVIEW_DOCUMENT_REPORTS = [
  { key: 'detailed_invoices', ar: 'فواتير البيع التفصيلية', en: 'Detailed sales invoices' },
  { key: 'purchases', ar: 'مستندات المشتريات', en: 'Purchase documents' },
  { key: 'expenses', ar: 'مستندات المصروفات', en: 'Expense documents' },
  { key: 'returns', ar: 'مرتجعات المبيعات', en: 'Sales returns' },
  { key: 'raw_material_consumption', ar: 'حركة واستهلاك الخامات', en: 'Raw material movements' },
] as const satisfies readonly { key: ReportType; ar: string; en: string }[];
