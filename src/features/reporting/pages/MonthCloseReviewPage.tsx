import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan, type Permission } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useLanguage } from '@/context/LanguageContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessReportAllowed } from '@/core/organizations/businessRuntime';
import { businessDateISO } from '@/lib/businessTime';
import { REPORT_REGISTRY } from '../reportRegistry';
import { MONTH_REVIEW_STEPS, monthReviewPeriod } from '../monthCloseReview';

type ReviewState = Record<string, boolean>;

/**
 * Manual monthly review, using already-authorized Premier reports.
 * No period lock, postings, financial roll-ups or close RPCs.
 */
export function MonthCloseReviewPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const navigate = useNavigate();
  const can = useCan();
  const history = useHistoryAccess();
  const { runtime } = useOrganizationModules();
  const [month, setMonth] = useState(() => businessDateISO().slice(0, 7));
  const [reviewed, setReviewed] = useState<ReviewState>({});

  let period: { from: string; to: string } | null = null;
  try { period = monthReviewPeriod(month); } catch { /* An invalid month must never be queried. */ }

  const allowedPeriod = period ? history.clampRange(period.from, period.to) : null;
  const completeHistory = !!period && allowedPeriod?.from === period.from && allowedPeriod.to === period.to;
  const availableSteps = MONTH_REVIEW_STEPS.filter(step => {
    const report = REPORT_REGISTRY.find(item => item.key === step.key);
    return !!report && report.permissions.every(permission => can(permission as Permission))
      && businessReportAllowed(runtime, report.key, report.category);
  });
  const completed = availableSteps.filter(step => reviewed[step.key]).length;

  const openReport = (key: string) => {
    if (!completeHistory || !period || !availableSteps.some(step => step.key === key)) return;
    navigate(`/reports/view?type=${encodeURIComponent(key)}&from=${period.from}&to=${period.to}`);
  };

  return (
    <section className="min-w-0 space-y-4" dir={ar ? 'rtl' : 'ltr'} data-testid="month-close-review-page">
      <header className="rounded-xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black text-ui-text">{ar ? 'مراجعة نهاية الشهر' : 'Month-end review'}</h1>
            <p className="mt-1 text-xs text-ui-muted">
              {ar
                ? 'قائمة مراجعة يدوية تفتح تقارير Premier الأصلية. لا تنشئ قيودًا أو تقفل الفترة المحاسبية.'
                : 'A manual checklist linked to Premier reports. It does not post entries or lock accounting periods.'}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/reports')}
            className="rounded-lg border border-ui-border px-3 py-2 text-xs font-bold text-ui-text">
            {ar ? 'العودة للتقارير' : 'Back to reports'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ui-border bg-ui-surface p-4">
        <label className="text-sm font-semibold text-ui-text">
          {ar ? 'شهر المراجعة' : 'Review month'}
          <input type="month" data-testid="month-review-picker" lang="en-GB-u-ca-gregory" dir="ltr"
            value={month} onChange={event => { setMonth(event.target.value); setReviewed({}); }}
            className="mt-1 block h-10 rounded-lg border border-ui-border bg-ui-page px-3 text-sm" />
        </label>
        <p className="text-xs text-ui-muted">{period ? `${period.from} — ${period.to}` : (ar ? 'الشهر غير صالح' : 'Invalid month')}</p>
        <p className="text-xs text-ui-muted">{ar ? `راجعته في هذه الجلسة: ${completed} من ${availableSteps.length}` : `Marked reviewed this session: ${completed} of ${availableSteps.length}`}</p>
      </div>

      {!completeHistory && (
        <p role="alert" className="rounded-xl border border-ui-warning/30 bg-ui-warning-soft p-3 text-sm text-ui-warning">
          {ar ? 'لا تسمح صلاحية التاريخ بمراجعة الشهر كاملًا. غيّر الشهر أو اطلب توسيع صلاحية الاطلاع؛ لن تُفتح تقارير بفترة مبتورة.'
            : 'Your history permission does not cover the entire month. Choose another month or request full history access; no partial-month reports will be opened.'}
        </p>
      )}
      {availableSteps.length === 0 && (
        <p role="status" className="rounded-xl border border-ui-border p-4 text-sm text-ui-muted">
          {ar ? 'لا توجد تقارير شهرية متاحة لصلاحياتك أو نوع نشاطك.' : 'No monthly review reports are available for your permissions or business type.'}
        </p>
      )}

      <div className="space-y-2">
        {availableSteps.map((step, index) => (
          <article key={step.key} className="flex flex-wrap items-start gap-3 rounded-xl border border-ui-border bg-ui-surface p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ui-page-alt text-xs font-bold text-ui-muted">{index + 1}</span>
            <div className="min-w-48 flex-1">
              <h2 className="text-sm font-bold text-ui-text">{ar ? step.ar : step.en}</h2>
              <p className="mt-1 text-xs text-ui-muted">{ar ? step.noteAr : step.noteEn}</p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" disabled={!completeHistory} onClick={() => openReport(step.key)}
                className="rounded-lg border border-ui-border px-3 py-2 text-xs font-semibold text-ui-primary disabled:opacity-40">
                {ar ? 'فتح التقرير' : 'Open report'}
              </button>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-ui-muted">
                <input type="checkbox" checked={!!reviewed[step.key]}
                  onChange={event => setReviewed(previous => ({ ...previous, [step.key]: event.target.checked }))} />
                {ar ? 'راجعت' : 'Reviewed'}
              </label>
            </div>
          </article>
        ))}
      </div>
      <p role="note" className="text-xs text-ui-muted">
        {ar
          ? 'علامات المراجعة مؤقتة في هذه الصفحة ولا تثبت صحة الأرقام أو إتمام الإقفال. راجع التسويات والمستندات مع المحاسب قبل أي إقفال رسمي.'
          : 'Review checkmarks are session-only and do not certify figures or close a period. Reconcile supporting records with an accountant before a formal close.'}
      </p>
    </section>
  );
}
