import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCan, type Permission } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useLanguage } from '@/context/LanguageContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessReportAllowed } from '@/core/organizations/businessRuntime';
import { businessDateISO } from '@/lib/businessTime';
import { REPORT_REGISTRY } from '../reportRegistry';
import { ReportsPage } from './ReportsPage';
import { monthReviewPeriod } from '../monthCloseReview';
import type { ReportType } from '../reportFilters';

const DOCUMENT_REPORTS = [
  { key: 'detailed_invoices', ar: 'فواتير البيع التفصيلية', en: 'Detailed sales invoices' },
  { key: 'purchases', ar: 'مستندات المشتريات', en: 'Purchase documents' },
  { key: 'expenses', ar: 'مستندات المصروفات', en: 'Expense documents' },
  { key: 'returns', ar: 'مرتجعات المبيعات', en: 'Sales returns' },
  { key: 'raw_material_consumption', ar: 'حركة واستهلاك الخامات', en: 'Raw material movements' },
] as const satisfies readonly { key: ReportType; ar: string; en: string }[];

/** Documents for review: live Premier report loaders, not a snapshot or ledger close. */
export function PeriodCloseDocumentsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const history = useHistoryAccess();
  const { runtime } = useOrganizationModules();
  const [month, setMonth] = useState(() => params.get('month') || businessDateISO().slice(0, 7));
  const period = useMemo(() => {
    try { return monthReviewPeriod(month); } catch { return null; }
  }, [month]);
  const allowed = period ? history.clampRange(period.from, period.to) : null;
  const allowedFullMonth = !!period && allowed?.from === period.from && allowed?.to === period.to;

  const permitted = DOCUMENT_REPORTS.filter(item => {
    const report = REPORT_REGISTRY.find(candidate => candidate.key === item.key);
    return !!report && report.permissions.every(permission => can(permission as Permission))
      && businessReportAllowed(runtime, report.key, report.category);
  });
  const selected = permitted.find(item => item.key === params.get('type')) || permitted[0];

  const changeReport = (type: ReportType) => {
    const next = new URLSearchParams(params);
    next.set('type', type);
    next.set('month', month);
    setParams(next);
  };

  return <section className="min-w-0 space-y-4" dir={ar ? 'rtl' : 'ltr'} data-testid="period-close-documents">
    <header className="rounded-xl border border-ui-border bg-ui-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{ar ? 'مستندات مراجعة الفترة' : 'Period review documents'}</h1>
          <p className="mt-1 text-xs text-ui-muted">{ar
            ? 'تُعرض تقارير المستندات الأصلية مباشرة. هذا العرض ليس أرشيف أدلة ثابتًا، ولا يُقفل الحسابات.'
            : 'Original document reports are loaded live. This is not an immutable evidence archive or an accounting period close.'}</p>
        </div>
        <button type="button" onClick={() => navigate('/reports/month-review')}
          className="rounded-lg border border-ui-border px-3 py-2 text-sm">
          {ar ? 'العودة لمراجعة الشهر' : 'Back to month review'}
        </button>
      </div>
    </header>

    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ui-border bg-ui-surface p-3">
      <label className="text-xs font-semibold">{ar ? 'الشهر' : 'Month'}
        <input type="month" lang="en-GB-u-ca-gregory" dir="ltr" value={month}
          onChange={event => { setMonth(event.target.value); const next = new URLSearchParams(params); next.set('month', event.target.value); setParams(next); }}
          className="mt-1 block rounded-lg border border-ui-border bg-ui-page p-2" />
      </label>
      {period && <p className="text-xs text-ui-muted" dir="ltr">{period.from} — {period.to}</p>}
    </div>
    {!allowedFullMonth ? (
      <p role="alert" className="rounded-xl border border-ui-warning/30 bg-ui-warning-soft p-3 text-sm">
        {ar ? 'هذا الشهر خارج نطاق التاريخ المسموح أو غير صالح. لن تُعرض بيانات جزئية باعتبارها شهرًا كاملًا.'
          : 'This month is invalid or outside permitted history. Partial data will not be shown as a complete month.'}
      </p>
    ) : !selected ? (
      <p role="alert" className="rounded-xl border border-ui-border p-3 text-sm">
        {ar ? 'لا تتوفر مستندات مراجعة بصلاحياتك الحالية.' : 'No document reports are available with your current permissions.'}
      </p>
    ) : <>
      <nav aria-label={ar ? 'أنواع مستندات المراجعة' : 'Review document types'}
        className="flex flex-wrap gap-2 rounded-xl border border-ui-border bg-ui-surface p-3">
        {permitted.map(item => <button type="button" key={item.key} onClick={() => changeReport(item.key)}
          aria-current={selected.key === item.key ? 'page' : undefined}
          className={`rounded-lg border px-3 py-2 text-xs font-bold ${selected.key === item.key
            ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border text-ui-text'}`}>
          {ar ? item.ar : item.en}
        </button>)}
      </nav>
      <ReportsPage key={selected.key + month} controlledReportType={selected.key}
        controlledFrom={period!.from} controlledTo={period!.to} standalone />
    </>}
  </section>;
}
