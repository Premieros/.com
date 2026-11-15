import type { ReportType } from './reportFilters';

export const CONSUMPTION_REPORT_TYPES = [
  'component_consumption',
  'raw_material_consumption',
  'top_consumed_components',
] as const satisfies readonly ReportType[];

export type ConsumptionReportType = (typeof CONSUMPTION_REPORT_TYPES)[number];

export const CONSUMPTION_REPORT_LABELS: Record<ConsumptionReportType, { ar: string; en: string; noteAr: string; noteEn: string }> = {
  component_consumption: {
    ar: 'تكلفة استهلاك المكونات', en: 'Component consumption cost',
    noteAr: 'يعرض استهلاك المكونات من الحركات المسجلة في الفروع المصرح بها، ولا يعيد تسعير الماضي.',
    noteEn: 'Shows recorded component movements within authorized branches; it does not reprice history.',
  },
  raw_material_consumption: {
    ar: 'حركة واستهلاك الخامات', en: 'Raw material movements',
    noteAr: 'بيانات الحركات المسجلة؛ تختلف عن تكلفة الوصفة النظرية بالأسعار الحالية.',
    noteEn: 'Recorded material movements, distinct from theoretical recipe cost at current prices.',
  },
  top_consumed_components: {
    ar: 'أكثر المكونات استهلاكًا', en: 'Top consumed components',
    noteAr: 'ترتيب كميات الاستهلاك المسجلة في الفترة، وليس تقرير تكلفة محاسبية مستقلًا.',
    noteEn: 'Ranks recorded consumed quantities in the period; not a separate accounting valuation.',
  },
};

/** Only routes to reports supported by Premier's existing report registry. */
export function isConsumptionReportType(value: string | null): value is ConsumptionReportType {
  return CONSUMPTION_REPORT_TYPES.some((type) => type === value);
}
