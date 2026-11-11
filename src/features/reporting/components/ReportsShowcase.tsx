import { BarChart3, ChartNoAxesCombined, Layers3, ShoppingBasket, Trophy, ArrowUpLeft } from 'lucide-react';
import type { ReportType } from '../reportFilters';

type Shortcut = {
  key: ReportType;
  ar: string;
  en: string;
  descriptionAr: string;
  descriptionEn: string;
  visual: 'line' | 'donut' | 'bars' | 'ranking';
};

const SHORTCUTS: Shortcut[] = [
  {
    key: 'sales', ar: 'المبيعات حسب الفترة', en: 'Sales over time',
    descriptionAr: 'افتح تحليل المبيعات الفعلي وحدد الفترة والفروع',
    descriptionEn: 'Open the existing sales report with period and branch filters',
    visual: 'line',
  },
  {
    key: 'sales_by_payment', ar: 'توزيع المبيعات حسب القنوات', en: 'Sales by payment channel',
    descriptionAr: 'توزيع من مصدر طرق الدفع المعتمد',
    descriptionEn: 'Distribution from the authorized payment-method source',
    visual: 'donut',
  },
  {
    key: 'sales_by_product', ar: 'الأصناف الأكثر مبيعًا', en: 'Top selling products',
    descriptionAr: 'الكميات والمبيعات من تقرير المنتجات الحالي',
    descriptionEn: 'Product quantities and sales from the existing report',
    visual: 'ranking',
  },
  {
    key: 'sales_by_employee', ar: 'تحليل أداء المبيعات', en: 'Sales performance',
    descriptionAr: 'أداء الموظفين وفق نطاق الفروع والصلاحيات',
    descriptionEn: 'Employee performance scoped to authorized branches',
    visual: 'bars',
  },
];

const ICONS = {
  line: ChartNoAxesCombined,
  donut: Layers3,
  ranking: Trophy,
  bars: BarChart3,
};

const TONES = {
  line: 'from-violet-100 to-indigo-50 text-violet-700 dark:from-violet-950/40 dark:to-indigo-950/20 dark:text-violet-300',
  donut: 'from-blue-100 to-sky-50 text-blue-700 dark:from-blue-950/40 dark:to-sky-950/20 dark:text-blue-300',
  ranking: 'from-amber-100 to-orange-50 text-amber-700 dark:from-amber-950/40 dark:to-orange-950/20 dark:text-amber-300',
  bars: 'from-emerald-100 to-teal-50 text-emerald-700 dark:from-emerald-950/40 dark:to-teal-950/20 dark:text-emerald-300',
};

export function ReportsShowcase({
  isAr,
  allowedReportTypes,
  onSelectReport,
}: {
  isAr: boolean;
  allowedReportTypes: ReadonlySet<ReportType>;
  onSelectReport: (type: ReportType) => void;
}) {
  const available = SHORTCUTS.filter((shortcut) => allowedReportTypes.has(shortcut.key));
  if (!available.length) return null;

  return (
    <section className="space-y-3" data-testid="reports-visual-overview">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-ui-text sm:text-lg">
            {isAr ? 'تحليلات وتقارير الأداء' : 'Performance analytics & reports'}
          </h2>
          <p className="mt-1 text-xs text-ui-muted">
            {isAr
              ? 'اختر أي تحليل لعرض الرسوم والأرقام الفعلية في تقريره، دون قيم توضيحية مصطنعة.'
              : 'Open a report to see its actual source-backed figures; no sample values are shown.'}
          </p>
        </div>
        <span className="rounded-lg border border-ui-border bg-ui-page-alt px-3 py-1.5 text-xs font-bold text-ui-muted">
          {isAr ? 'تقارير مصرح بها' : 'Authorized reports'} · {available.length}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {available.map((shortcut) => {
          const Icon = ICONS[shortcut.visual];
          return (
            <button
              type="button"
              key={shortcut.key}
              onClick={() => onSelectReport(shortcut.key)}
              className="group min-w-0 overflow-hidden rounded-2xl border border-ui-border bg-ui-surface p-4 text-start shadow-ui-sm transition hover:border-ui-primary hover:shadow-ui-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-primary"
              data-testid={`report-shortcut-${shortcut.key}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${TONES[shortcut.visual]}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <ArrowUpLeft className="h-4 w-4 text-ui-muted transition group-hover:text-ui-primary" aria-hidden="true" />
              </div>
              <h3 className="mt-3 text-sm font-black text-ui-text">
                {isAr ? shortcut.ar : shortcut.en}
              </h3>
              <p className="mt-1 text-xs leading-5 text-ui-muted">
                {isAr ? shortcut.descriptionAr : shortcut.descriptionEn}
              </p>
              <span className="mt-4 inline-flex items-center gap-2 text-xs font-extrabold text-ui-primary">
                <ShoppingBasket className="h-4 w-4" aria-hidden="true" />
                {isAr ? 'فتح التقرير الفعلي' : 'Open real report'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
