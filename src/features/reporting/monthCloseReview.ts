/** Gregorian month ranges for review links, independent of browser locale. */
export interface MonthReviewPeriod { from: string; to: string }

export function monthReviewPeriod(month: string): MonthReviewPeriod {
  if (!/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('INVALID_MONTH');
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export type CloseReviewReport = 'sales' | 'financial_reconciliation' | 'purchases' | 'expenses'
  | 'component_consumption' | 'raw_material_consumption' | 'profit';

export const MONTH_REVIEW_STEPS: readonly {
  key: CloseReviewReport;
  ar: string; en: string;
  noteAr: string; noteEn: string;
}[] = [
  { key: 'sales', ar: 'مراجعة صافي المبيعات والمرتجعات', en: 'Review sales and refunds',
    noteAr: 'طابق الفواتير مع التحصيل والطلبات المفتوحة.', noteEn: 'Reconcile sales invoices with collections and open orders.' },
  { key: 'financial_reconciliation', ar: 'مراجعة التسوية المالية', en: 'Review financial reconciliation',
    noteAr: 'راجع فروق النقدي والكارت والتحويل والآجل مع الورديات والخزائن.', noteEn: 'Review cash, card, transfer and credit differences against shifts and treasury.' },
  { key: 'purchases', ar: 'مراجعة المشتريات والموردين', en: 'Review purchases and suppliers',
    noteAr: 'طابق فواتير الشراء والمرتجعات والمدفوعات.', noteEn: 'Reconcile purchase invoices, returns and payments.' },
  { key: 'expenses', ar: 'مراجعة المصروفات', en: 'Review expenses',
    noteAr: 'تأكد من التصنيفات والمستندات المؤيدة.', noteEn: 'Verify expense categories and supporting documents.' },
  { key: 'component_consumption', ar: 'مراجعة استهلاك المكونات', en: 'Review component consumption',
    noteAr: 'راجع الحركات المسجلة وتكاليفها؛ ليست تكلفة وصفة تقديرية.', noteEn: 'Check recorded component movements and costs, not theoretical recipe costing.' },
  { key: 'raw_material_consumption', ar: 'مراجعة حركة الخامات والمخزون', en: 'Review material and inventory movements',
    noteAr: 'طابق أرصدة أول وآخر المدة مع حركات المخزون.', noteEn: 'Reconcile opening and closing balances against inventory movements.' },
  { key: 'profit', ar: 'مراجعة صافي الربح المحاسبي', en: 'Review accounting profit',
    noteAr: 'افحص قيود المصروفات والإيرادات، ولا تعتبر هذه القائمة إقفالًا محاسبيًا.', noteEn: 'Inspect journal-based revenue and expenses; this checklist does not close the ledger.' },
];
