import { useEffect, useRef, useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { reporting } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessFinancialViewAllowed } from '@/core/organizations/businessRuntime';
import { useBranchScope } from '@/lib/branchScope';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { addIsoDays, businessDateISO } from '@/lib/businessTime';
import { formatFinancialCurrency } from '@/lib/format';
import { incomeMargin, type INCOME_KEYS } from '../incomeKpiIntegrity';
import { assessIncomeReadiness, type IncomeReadiness } from '../incomeReadiness';
import { requireFinancialReport } from '../services/requireFinancialReport';

type IncomeField = typeof INCOME_KEYS[number];
type Snapshot = { readiness: IncomeReadiness; scopeKey: string; from: string; to: string };

const METRICS: Array<{ key: IncomeField; ar: string; en: string }> = [
  { key: 'net_revenue', ar: 'صافي الإيرادات', en: 'Net revenue' },
  { key: 'cogs', ar: 'تكلفة البضاعة المباعة', en: 'Cost of goods sold' },
  { key: 'gross_profit', ar: 'مجمل الربح', en: 'Gross profit' },
  { key: 'expenses', ar: 'المصروفات', en: 'Expenses' },
  { key: 'net_income', ar: 'صافي الربح / الخسارة', en: 'Net income' },
];
const LABELS: Record<IncomeField, { ar: string; en: string }> = {
  revenue: { ar: 'إجمالي الإيرادات', en: 'Gross revenue' },
  discount: { ar: 'الخصومات', en: 'Discounts' },
  net_revenue: { ar: 'صافي الإيرادات', en: 'Net revenue' },
  cogs: { ar: 'تكلفة البضاعة المباعة', en: 'COGS' },
  gross_profit: { ar: 'مجمل الربح', en: 'Gross profit' },
  expenses: { ar: 'المصروفات', en: 'Expenses' },
  net_income: { ar: 'صافي الربح / الخسارة', en: 'Net income' },
};
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function ReportsExecutiveKpis() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const can = useCan();
  const { runtime } = useOrganizationModules();
  const branchScope = useBranchScope();
  const { effectiveSettings } = useSettings();
  const history = useHistoryAccess();
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => addIsoDays(businessDateISO(), -29));
  const [to, setTo] = useState(() => businessDateISO());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const authorized = can('reports.financial') && businessFinancialViewAllowed(runtime, 'income');

  useEffect(() => {
    // Never reuse financial numbers after a permission or branch-scope change.
    generation.current += 1;
    setSnapshot(null);
    setError(null);
    setLoading(false);
  }, [branchScope.scopeKey, authorized]);

  if (!authorized) return null;

  const run = async () => {
    const callId = ++generation.current;
    setSnapshot(null);
    setError(null);
    setLoading(true);
    const branchIds = [...branchScope.selectedBranchIds];
    const scopeKey = branchScope.scopeKey;
    const start = from, end = to;
    try {
      if (branchIds.length === 0) throw new Error('NO_BRANCH');
      if (!validDate(start) || !validDate(end) || start > end) throw new Error('INVALID_RANGE');
      const allowed = history.clampRange(start, end);
      if (allowed.from !== start || allowed.to !== end) throw new Error('OUTSIDE_ALLOWED_HISTORY');

      // Every authorized branch gets a row, including failed / incomplete RPCs.
      // Partial branch figures are visible with an explicit completion checklist,
      // but never labeled as a finalized multi-branch total.
      const reports = await Promise.all(branchIds.map(async (branchId) => {
        try {
          const response = await reporting.getIncomeStatement({
            p_branch_id: branchId, p_from_date: start, p_to_date: end,
          });
          return {
            report: requireFinancialReport(response, 'income', branchId) as unknown,
            fetchFailed: false,
          };
        } catch {
          return { report: null, fetchFailed: true };
        }
      }));
      const readiness = assessIncomeReadiness(branchIds.map((branchId, index) => {
        const branch = branchScope.organizationBranches.find((item) => item.id === branchId);
        return {
          branchId,
          branchName: (isAr ? branch?.name : (branch?.name_en || branch?.name)) || branchId,
          currency: effectiveSettings(branchId)?.currency || null,
          report: reports[index].report,
          fetchFailed: reports[index].fetchFailed,
        };
      }));
      if (callId === generation.current) {
        setSnapshot({ readiness, scopeKey, from: start, to: end });
      }
    } catch (cause) {
      if (callId === generation.current) {
        setError(cause instanceof Error && cause.message === 'NO_BRANCH'
          ? (isAr ? 'أكمل التالي: اختر فرعًا مصرحًا لك لعرض المؤشرات.' : 'To complete: select an authorized branch.')
          : (isAr ? 'أكمل التالي: راجع تاريخ البداية والنهاية ونطاق التاريخ المسموح لك.' : 'To complete: check the start/end dates and permitted history range.'));
      }
    } finally {
      if (callId === generation.current) setLoading(false);
    }
  };

  const current = snapshot?.scopeKey === branchScope.scopeKey && snapshot.from === from && snapshot.to === to
    ? snapshot : null;
  const readiness = current?.readiness;
  const total = readiness?.total;
  const missingLabel = isAr ? 'يلزم استكمال البيانات' : 'Needs completion';

  return (
    <section className="rounded-xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm sm:p-5"
      data-testid="premier-income-kpi-panel" aria-label={isAr ? 'المؤشرات المحاسبية المعتمدة' : 'Authoritative accounting KPIs'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-base font-black text-ui-text">
            <BarChart3 className="h-5 w-5 text-ui-primary" />
            {isAr ? 'مؤشرات قائمة الدخل' : 'Income statement KPIs'}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-ui-muted">
            {isAr
              ? 'كل المؤشرات ظاهرة حتى إذا كانت البيانات ناقصة. القيم الموجودة تُعرض من قائمة الدخل المعتمدة، والناقصة تُعرض مع المطلوب استكماله.'
              : 'All indicators remain visible even with missing data. Available numbers come from the authoritative income statement; missing values have a completion checklist.'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg bg-ui-page-alt px-2 py-1 text-xs font-semibold text-ui-muted">
          <ShieldCheck className="h-4 w-4" />
          {isAr ? 'خاضع للصلاحيات ونطاق الفروع' : 'Scoped by permissions and branches'}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ui-muted sm:max-w-44">
          {isAr ? 'من تاريخ' : 'From'}
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setSnapshot(null); }}
            className="h-10 rounded-lg border border-ui-border bg-ui-page-alt px-2 text-sm text-ui-text" />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ui-muted sm:max-w-44">
          {isAr ? 'إلى تاريخ' : 'To'}
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setSnapshot(null); }}
            className="h-10 rounded-lg border border-ui-border bg-ui-page-alt px-2 text-sm text-ui-text" />
        </label>
        <button type="button" onClick={() => void run()} disabled={loading || branchScope.selectedBranchIds.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-ui-primary px-4 text-sm font-bold text-ui-primary-fg disabled:opacity-50"
          data-testid="run-income-kpis">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? (isAr ? 'جارٍ تحميل البيانات...' : 'Loading data...') : (isAr ? 'تحميل / تحديث المؤشرات' : 'Load / refresh KPIs')}
        </button>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-ui-danger/30 bg-ui-danger-soft p-3 text-sm text-ui-danger">{error}</p>}
      <p className="mt-4 text-xs font-bold text-ui-muted">
        {total ? (isAr ? 'إجمالي مكتمل للفروع المختارة' : 'Complete total for selected branches')
          : (isAr ? 'الإجمالي الموحّد غير مكتمل — القيم المتاحة لكل فرع بالأسفل' : 'Consolidated total incomplete — available branch figures below')}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {METRICS.map((metric) => (
          <div key={metric.key} className="min-w-0 rounded-lg border border-ui-border bg-ui-page-alt p-3" data-testid={`income-kpi-${metric.key}`}>
            <p className="text-xs text-ui-muted">{isAr ? metric.ar : metric.en}</p>
            <p className="mt-2 break-words text-base font-black tabular-nums text-ui-text">
              {total && readiness?.currency
                ? formatFinancialCurrency(total[metric.key], readiness.currency, lang)
                : <span className="text-sm text-ui-muted">{current ? missingLabel : (isAr ? 'لم يُحمَّل بعد' : 'Not loaded')}</span>}
            </p>
          </div>
        ))}
      </div>

      {readiness && (
        <>
          <p className="mt-3 text-xs text-ui-muted">{isAr ? 'الفترة:' : 'Period:'} {current?.from} – {current?.to}</p>
          {readiness.issues.length > 0 && (
            <section role="alert" className="mt-3 rounded-lg border border-ui-warning/40 bg-ui-page-alt p-4" data-testid="income-completion-checklist">
              <div className="flex items-center gap-2 font-bold text-ui-text"><AlertCircle className="h-4 w-4" />
                {isAr ? 'أكمل التالي' : 'Complete the following'}
              </div>
              <p className="mt-1 text-xs text-ui-muted">
                {isAr ? 'القيم المتوفرة لكل فرع ظاهرة أدناه. لا يُعتمد الإجمالي الموحّد حتى استكمال المطلوب أو إعادة التحميل.'
                  : 'Available branch amounts remain visible below. The consolidated total is pending completion or refresh.'}
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-ui-text">
                {readiness.issues.map((issue, index) => (
                  <li key={`${issue.branchId}-${index}`}>
                    <strong>{issue.branchName}:</strong>{' '}
                    {issue.missing.map((field) =>
                      field === 'currency_mismatch' ? (isAr ? 'راجع اختلاف عملة الفروع، ولا يتم جمع عملات مختلفة' : 'Resolve different branch currencies before consolidation')
                        : field === 'currency' ? (isAr ? 'حدد عملة الفرع في الإعدادات' : 'Set the branch currency')
                          : field === 'report_unavailable' ? (isAr ? 'راجع قيود قائمة الدخل أو اتصال التقرير ثم أعد التحميل' : 'Review income statement records or report connection, then reload')
                            : isAr ? LABELS[field as IncomeField]?.ar || field : LABELS[field as IncomeField]?.en || field
                    ).join(isAr ? '، ' : ', ')}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="mt-4 overflow-x-auto" data-testid="income-branch-values">
            <table className="w-full min-w-[650px] text-start text-xs">
              <caption className="mb-2 text-start font-semibold text-ui-text">{isAr ? 'قيم كل فرع، بما فيها الخانات الناقصة' : 'Per-branch amounts, including missing fields'}</caption>
              <thead><tr className="border-b border-ui-border">
                <th scope="col" className="p-2 text-start">{isAr ? 'الفرع' : 'Branch'}</th>
                {METRICS.map((metric) => <th key={metric.key} scope="col" className="p-2 text-start">{isAr ? metric.ar : metric.en}</th>)}
              </tr></thead>
              <tbody>
                {readiness.branches.map((item) => (
                  <tr key={item.branchId} className="border-b border-ui-border">
                    <th scope="row" className="p-2 text-start font-bold">{item.branchName}</th>
                    {METRICS.map((metric) => (
                      <td key={metric.key} className="p-2 tabular-nums">
                        {item.values[metric.key] !== undefined && item.currency
                          ? formatFinancialCurrency(item.values[metric.key], item.currency, lang)
                          : <span className="font-semibold text-ui-muted">{item.values[metric.key] !== undefined
                            ? (isAr ? 'العملة غير محددة' : 'Currency missing')
                            : missingLabel}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ui-muted">
              <p>{isAr ? 'هامش صافي الربح:' : 'Net margin:'} {incomeMargin(total.net_income, total.net_revenue) === null
                ? (isAr ? 'غير قابل للحساب عند غياب إيراد موجب' : 'Not applicable without positive net revenue')
                : `${incomeMargin(total.net_income, total.net_revenue)!.toFixed(2)}%`}</p>
            </div>
          )}
          <button type="button" className="mt-3 text-xs font-bold text-ui-primary hover:underline"
            onClick={() => navigate(`/reports?section=financial&view=income&from=${current?.from}&to=${current?.to}`)}>
            {isAr ? 'فتح قائمة الدخل لاستكمال أو مراجعة البيانات' : 'Open income statement to complete or review the data'}
          </button>
        </>
      )}
      {!current && !error && !loading && (
        <p className="mt-4 text-xs text-ui-muted">
          {isAr ? 'المؤشرات ظاهرة الآن كخانات غير محمّلة. اختر الفترة ثم حمّل القيم لرؤية الناقص والمطلوب استكماله.'
            : 'Indicators remain visible as unloaded placeholders. Choose a period and load to see missing values and next steps.'}
        </p>
      )}
    </section>
  );
}
