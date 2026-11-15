import type { ReportType } from './reportFilters';

export interface ReportSummaryPresentation {
  totalLabel: string;
  countLabel: string;
  totalIsQuantity: boolean;
  note: string;
}

/**
 * Present the existing authoritative report summary without recalculating it.
 * A count/quantity must never be formatted as a currency amount.
 */
export function reportSummaryPresentation(type: ReportType, lang: 'ar' | 'en'): ReportSummaryPresentation {
  const label = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const totals: Partial<Record<ReportType, [string, string]>> = {
    sales: ['صافي المبيعات', 'Net sales'],
    sales_by_payment: ['إجمالي التوزيع حسب طريقة الدفع', 'Payment allocation total'],
    sales_by_employee: ['صافي المبيعات', 'Net sales'],
    sales_by_product: ['صافي المبيعات', 'Net sales'],
    detailed_invoices: ['صافي المبيعات', 'Net sales'],
    purchases: ['صافي المشتريات', 'Net purchases'],
    expenses: ['المصروفات', 'Expenses'],
    profit: ['صافي الربح المحاسبي', 'Accounting net profit'],
    cashier_performance: ['صافي المبيعات', 'Net sales'],
    returns: ['قيمة المرتجعات', 'Refund value'],
    component_consumption: ['تكلفة الاستهلاك المسجلة', 'Recorded consumption cost'],
    recipe_costs: ['إجمالي تكلفة الوصفات', 'Total recipe costs'],
    production_waste: ['قيمة الهالك المسجلة', 'Recorded waste value'],
    raw_material_consumption: ['قيمة الاستهلاك المسجلة', 'Recorded consumption value'],
    raw_material_current_cost: ['قيمة التكلفة الحالية', 'Current cost value'],
    raw_material_financial: ['القيمة المحاسبية المسجلة', 'Recorded accounting value'],
    sales_component_reconciliation: ['قيمة الاستهلاك النظري', 'Theoretical consumption value'],
    financial_reconciliation: ['صافي المبيعات', 'Net sales'],
    inventory: ['إجمالي الكمية', 'Total quantity'],
    low_stock: ['عدد الأصناف منخفضة المخزون', 'Low-stock item count'],
    top_consumed_components: ['عدد المكونات المعروضة', 'Displayed component groups'],
    top_consumed_products: ['عدد المنتجات المعروضة', 'Displayed product groups'],
  };
  const quantityTypes: ReportType[] = ['inventory', 'low_stock', 'top_consumed_components', 'top_consumed_products'];
  const basis: Partial<Record<ReportType, [string, string]>> = {
    sales_by_payment: [
      'قد يشمل التوزيع الدفع الآجل؛ ولا يمثل بالكامل النقدية المحصلة أو حركة الخزنة.',
      'Payment allocation may include credit; it is not entirely collected cash or treasury movement.',
    ],
    raw_material_consumption: [
      'يعرض قيمة الحركات المسجلة، وليس إعادة تقييم المخزون بآخر سعر.',
      'Shows recorded movement values, not inventory revaluation at the latest price.',
    ],
    raw_material_financial: [
      'القيمة المحاسبية المسجلة تختلف عن إعادة التقييم بالسعر الحالي.',
      'Recorded accounting value differs from revaluation at current prices.',
    ],
    financial_reconciliation: [
      'صافي المبيعات لا يساوي بالضرورة النقدية المحصلة.',
      'Net sales do not necessarily equal collected cash.',
    ],
  };
  const total = totals[type];
  const countLabel = type === 'sales_component_reconciliation'
    ? label('عدد الفروق', 'Mismatch count')
    : type === 'financial_reconciliation'
      ? label('عدد الفروق', 'Mismatch count')
      : label('العدد', 'Count');
  return {
    totalLabel: total ? label(...total) : label('الإجمالي', 'Total'),
    countLabel,
    totalIsQuantity: quantityTypes.includes(type),
    note: basis[type] ? label(...basis[type]!) : '',
  };
}
