import { BarChart3, TrendingUp, Layers3, Trophy, ArrowUpLeft, ExternalLink, Store, LineChart } from 'lucide-react';
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
    ar: 'المبيعات حسب الفترة',
    en: 'Sales over time',
    descriptionAr: 'اتجاه المبيعات للفترة والفروع المختارة داخل التقرير الفعلي.',
    descriptionEn: 'Sales trend for the selected period and authorized branches.',
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
}: {
  isAr: boolean;
  allowedReportTypes: ReadonlySet<ReportType>;
  onSelectReport: (type: ReportType) => void;
}) {
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
      <div className="grid gap-3 md:grid-cols-2">
        {tiles.map((tile) => {
          const Icon = ICONS[tile.kind];
          return (
            <button
              type="button"
              key={tile.key}
              onClick={() => onSelectReport(tile.key)}
              data-testid={`report-shortcut-${tile.key}`}
              className="group flex min-h-[220px] flex-col rounded-2xl border border-ui-border bg-ui-surface p-4 text-start shadow-ui-sm transition hover:border-ui-primary hover:shadow-ui-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-primary"
              aria-label={isAr ? `فتح التقرير الفعلي: ${tile.ar}` : `Open actual report: ${tile.en}`}
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
              <div className="my-4 flex w-full flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-ui-border bg-ui-page-alt/50 px-4 py-5 text-center">
                <TrendingUp className="mb-2 h-7 w-7 text-ui-primary/70" aria-hidden="true" />
                <p className="text-xs font-bold text-ui-text">
                  {isAr ? 'المخطط الفعلي متاح داخل التقرير' : 'Actual chart available in report'}
                </p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-ui-muted">
                  {isAr ? tile.descriptionAr : tile.descriptionEn}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-ui-primary">
                <ExternalLink className="h-4 w-4" />
                {isAr ? 'فتح البيانات والرسوم الفعلية' : 'Open actual data and charts'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
