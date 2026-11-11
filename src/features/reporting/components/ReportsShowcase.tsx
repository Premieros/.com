import { useState } from 'react';
import { BarChart3, TrendingUp, Layers3, Trophy, ArrowUpLeft, ExternalLink, Store, LineChart, RefreshCw } from 'lucide-react';
import { ReportsPage } from '../pages/ReportsPage';
import type { ReportType } from '../reportFilters';

type Tile = {
  key: ReportType;
  ar: string;
  en: string;
  descriptionAr: string;
  descriptionEn: string;
  kind: 'line' | 'donut' | 'ranking' | 'bars';
};

const TILES: Tile[] = [
  {
    key: 'sales_by_payment',
    ar: 'توزيع المبيعات حسب طرق الدفع',
    en: 'Sales by payment method',
    descriptionAr: 'المصدر المعتمد لطرق الدفع. افتح التقرير لعرض التوزيع الفعلي.',
    descriptionEn: 'Authorized payment breakdown. Open the report for real figures.',
    kind: 'donut',
  },
  {
    key: 'sales',
    ar: 'أحدث فواتير المبيعات',
    en: 'Recent sales invoices',
    descriptionAr: 'قيم أحدث عشر فواتير مسجلة في التقرير المعتمد، وليست إجمالي المبيعات اليومي.',
    descriptionEn: 'Values of the ten most recent invoices; not a daily sales total.',
    kind: 'line',
  },
  {
    key: 'sales_by_employee',
    ar: 'أداء المبيعات حسب الموظف',
    en: 'Sales performance by employee',
    descriptionAr: 'مقارنة الأداء من بيانات الموظفين المصرح بعرضها.',
    descriptionEn: 'Compare performance from authorized employee sales.',
    kind: 'bars',
  },
  {
    key: 'sales_by_product',
    ar: 'الأصناف الأكثر مبيعًا',
    en: 'Top selling products',
    descriptionAr: 'الكميات والإيرادات حسب الأصناف من نفس مصدر تقرير المنتجات.',
    descriptionEn: 'Product quantities and revenue from the original report.',
    kind: 'ranking',
  },
];

const ICONS = { line: LineChart, donut: Layers3, ranking: Trophy, bars: Store };

const TONES = {
  line: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  donut: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ranking: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  bars: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

export function ReportsShowcase({
  isAr,
  allowedReportTypes,
  onSelectReport,
  from,
  to,
}: {
  isAr: boolean;
  allowedReportTypes: ReadonlySet<ReportType>;
  onSelectReport: (type: ReportType) => void;
  from: string;
  to: string;
}) {
  const [chartRun, setChartRun] = useState(0);
  const tiles = TILES.filter((tile) => allowedReportTypes.has(tile.key));
  if (!tiles.length) return null;

  return (
    <section data-testid="reports-visual-overview" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-black text-ui-text sm:text-lg">
          {isAr ? 'تحليلات وتقارير الأداء' : 'Performance analytics'}
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-ui-border bg-ui-surface px-3 py-1.5 text-xs text-ui-muted">
          <BarChart3 className="h-4 w-4" />
          {isAr ? 'البيانات من التقارير المعتمدة' : 'Source-backed reports'}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2">
        <p className="text-xs text-ui-muted">{isAr
          ? 'الرسوم تعتمد على نفس محركات التقارير الحالية، وتُحمَّل عند الطلب لتقليل ضغط قاعدة البيانات.'
          : 'Charts reuse existing report loaders and are loaded on demand.'}</p>
        <button type="button" onClick={() => setChartRun((value) => value + 1)}
          data-testid="load-overview-charts"
          className="inline-flex items-center gap-2 rounded-lg bg-ui-primary px-3 py-2 text-xs font-bold text-ui-primary-fg">
          <RefreshCw className="h-4 w-4" />
          {chartRun ? (isAr ? 'تحديث الرسوم' : 'Refresh charts') : (isAr ? 'عرض الرسوم الفعلية' : 'Load real charts')}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {tiles.map((tile) => {
          const Icon = ICONS[tile.kind];
          return (
            <div
              key={tile.key}
              data-testid={`report-shortcut-${tile.key}`}
              className="group flex min-h-[220px] flex-col rounded-2xl border border-ui-border bg-ui-surface p-4 text-start shadow-ui-sm transition hover:border-ui-primary hover:shadow-ui-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-primary"
            >
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONES[tile.kind]}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-sm font-black text-ui-text">{isAr ? tile.ar : tile.en}</h3>
                </div>
                <ArrowUpLeft className="h-4 w-4 shrink-0 text-ui-muted group-hover:text-ui-primary" aria-hidden="true" />
              </div>
              <div className="my-4 w-full flex-1 rounded-xl border border-ui-border bg-ui-page-alt/30 px-2 py-3">
                {chartRun > 0 ? (
                  <ReportsPage key={`${tile.key}-${chartRun}`} controlledReportType={tile.key} chartOnly controlledFrom={from} controlledTo={to} />
                ) : (
                  <div className="flex min-h-44 flex-col items-center justify-center text-center">
                    <TrendingUp className="mb-2 h-7 w-7 text-ui-primary/70" aria-hidden="true" />
                    <p className="text-xs font-bold text-ui-text">
                      {isAr ? 'اضغط عرض الرسوم الفعلية لتحميل البيانات' : 'Load the actual report charts'}
                    </p>
                  </div>
                )}
                <p className="mt-2 text-center text-[11px] leading-5 text-ui-muted">
                  {isAr ? tile.descriptionAr : tile.descriptionEn}
                </p>
              </div>
              <button type="button" onClick={() => onSelectReport(tile.key)}
                className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs font-extrabold text-ui-primary hover:bg-ui-primary-soft"
                aria-label={isAr ? `فتح التقرير الفعلي: ${tile.ar}` : `Open actual report: ${tile.en}`}>
                <ExternalLink className="h-4 w-4" />
                {isAr ? 'فتح تفاصيل التقرير' : 'Open report details'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
