import { useEffect, useRef, useState } from 'react';
import { BarChart3, RefreshCw, ShieldCheck } from 'lucide-react';
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
import type { IncomeStatementResult } from '@/lib/types';
import { aggregateIncomeStatements, incomeMargin } from '../incomeKpiIntegrity';
import { requireFinancialReport } from '../services/requireFinancialReport';

type Snapshot = { data: IncomeStatementResult; currency: string; scopeKey: string; from: string; to: string };

export function ReportsExecutiveKpis() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const can = useCan();
  const { runtime } = useOrganizationModules();
  const branchScope = useBranchScope();
  const { effectiveSettings } = useSettings();
  const history = useHistoryAccess();
  const navigate = useNavigate();
  const today = businessDateISO();
  const [from, setFrom] = useState(() => addIsoDays(businessDateISO(), -29));
  const [to, setTo] = useState(today);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const authorized = can('reports.financial') && businessFinancialViewAllowed(runtime, 'income');

  useEffect(() => {
    // Invalidate results and any in-flight request as soon as the selected
    // tenant/branch authorization context changes.
    generation.current += 1;
    setSnapshot(null);
    setError(null);
    setLoading(false);
  }, [branchScope.scopeKey, authorized]);

  if (!authorized) return null;

  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

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
      const currencies = branchIds.map((branchId) => effectiveSettings(branchId)?.currency);
      if (currencies.some((currency) => !currency) || new Set(currencies).size !== 1) {
        throw new Error('INCOMPATIBLE_CURRENCIES');
      }
      const results = await Promise.all(branchIds.map((branchId) =>
        reporting.getIncomeStatement({ p_branch_id: branchId, p_from_date: start, p_to_date: end })
      ));
      const data = aggregateIncomeStatements(results.map((result, index) =>
        requireFinancialReport(result, 'income', branchIds[index])
      ));
      if (callId === generation.current) {
        setSnapshot({ data, currency: currencies[0] as string, scopeKey, from: start, to: end });
      }
    } catch (cause) {
      if (callId === generation.current) {
        setError(cause instanceof Error && cause.message === 'INCOMPATIBLE_CURRENCIES'
          ? (isAr ? 'الفروع المختارة تستخدم عملات مختلفة أو إعدادات عملات ناقصة. اختر فروعًا بعملة واحدة، فلا يتم جمع العملات دون تحويل معتمد.' : 'Selected branches use different or missing currencies. Choose branches with one currency; no unapproved conversion is performed.')
          : cause instanceof Error && cause.message === 'NO_BRANCH'
            ? (isAr ? 'حدد فرعًا مصرحًا لعرض المؤشرات.' : 'Select an authorized branch.')
            : cause instanceof Error && (cause.message === 'INVALID_RANGE' || cause.message === 'OUTSIDE_ALLOWED_HISTORY')
              ? (isAr ? 'الفترة غير صحيحة أو خارج نطاق التاريخ المسموح.' : 'Invalid or unauthorized date range.')
              : (isAr ? 'تعذر استكمال قائمة الدخل لجميع الفروع. تم إخفاء المؤشرات لمنع عرض إجماليات مالية ناقصة.' : 'Could not retrieve complete income statements for every branch. Partial financial totals are hidden.'));
      }
    } finally {
      if (callId === generation.current) setLoading(false);
    }
  };

  const current = snapshot?.scopeKey === branchScope.scopeKey && snapshot.from === from && snapshot.to === to
    ? snapshot : null;
  const metrics = current ? [
    { key: 'net_revenue', ar: 'صافي الإيرادات', en: 'Net revenue' },
    { key: 'cogs', ar: 'تكلفة البضاعة المباعة', en: 'COGS' },
    { key: 'gross_profit', ar: 'مجمل الربح', en: 'Gross profit' },
    { key: 'expenses', ar: 'المصروفات', en: 'Expenses' },
    { key: 'net_income', ar: 'صافي الربح / الخسارة', en: 'Net income' },
  ] as const : [];

  return (
    <section className="rounded-xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm sm:p-5"
      data-testid="premier-income-kpi-panel" aria-label={isAr ? 'المؤشرات المحاسبية المعتمدة' : 'Authoritative accounting KPIs'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-base font-black text-ui-text"><BarChart3 className="h-5 w-5 text-ui-primary" />{isAr ? 'مؤشرات قائمة الدخل' : 'Income statement KPIs'}</h2>
          <p className="mt-1 max-w-2xl text-xs text-ui-muted">
            {isAr ? 'من نفس تقرير قائمة الدخل المعتمد لكل فرع، وليس من جمع فواتير أو رصيد شاشة الكاشير. تُعرض فقط بعد اكتمال جميع الفروع المحددة.'
              : 'From the same authorized income-statement report per branch, not reconstructed from invoices or cashier balances. Only shown when every selected branch succeeds.'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg bg-ui-page-alt px-2 py-1 text-xs font-semibold text-ui-muted">
          <ShieldCheck className="h-4 w-4" />{isAr ? 'خاضع للصلاحيات ونطاق الفروع' : 'Scoped by permissions and branches'}
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
          {loading ? (isAr ? 'جارٍ التحقق...' : 'Validating...') : (isAr ? 'تحميل المؤشرات' : 'Load KPIs')}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-ui-danger/30 bg-ui-danger-soft p-3 text-sm text-ui-danger">{error}</p>}
      {current && (
        <>
          <p className="mt-4 text-xs text-ui-muted">{isAr ? 'فترة التقرير المعتمد:' : 'Certified report range:'} {current.from} – {current.to} · {branchScope.selectedBranchIds.length} {isAr ? 'فرع' : 'branch(es)'}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {metrics.map((metric) => (
              <div key={metric.key} className="min-w-0 rounded-lg border border-ui-border bg-ui-page-alt p-3">
                <p className="text-xs text-ui-muted">{isAr ? metric.ar : metric.en}</p>
                <p className="mt-2 break-words text-base font-black tabular-nums text-ui-text">
                  {formatFinancialCurrency(current.data[metric.key], current.currency, lang)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ui-muted">
            <p>{isAr ? 'هامش صافي الربح:' : 'Net margin:'} {incomeMargin(current.data.net_income, current.data.net_revenue) === null
              ? (isAr ? 'غير قابل للحساب عند غياب إيراد موجب' : 'Not applicable without positive net revenue')
              : `${incomeMargin(current.data.net_income, current.data.net_revenue)!.toFixed(2)}%`}</p>
            <button type="button" className="font-bold text-ui-primary hover:underline"
              onClick={() => navigate(`/reports?section=financial&view=income&from=${current.from}&to=${current.to}`)}>
              {isAr ? 'فتح قائمة الدخل التفصيلية' : 'Open detailed income statement'}
            </button>
          </div>
        </>
      )}
      {!current && !error && !loading && <p className="mt-4 text-xs text-ui-muted">{isAr ? 'اختر الفترة واضغط تحميل المؤشرات. لا يتم عرض قيم قديمة عند تغيير الفرع أو الفترة.' : 'Choose dates and load KPIs. Previous figures are not reused after changing branches or dates.'}</p>}
    </section>
  );
}
