import { ArrowRight, FileBarChart } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
import { useCan, type Permission } from '@/lib/permissions';
import { REPORT_REGISTRY } from '../reportRegistry';
import type { ReportType } from '../reportFilters';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessReportAllowed, businessFinancialViewAllowed } from '@/core/organizations/businessRuntime';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useLanguage } from '@/context/LanguageContext';
import { businessDateISO, addIsoDays } from '@/lib/businessTime';

export function ReportFullPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const can = useCan();
  const { runtime } = useOrganizationModules();
  const history = useHistoryAccess();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const type = params.get('type');
  const financialView = params.get('view');
  const isFinancial = params.get('section') === 'financial';
  const from = params.get('from') || addIsoDays(businessDateISO(), -6);
  const to = params.get('to') || businessDateISO();
  const allowedDates = history.clampRange(from, to);
  const allowedReport = REPORT_REGISTRY.find((item) =>
    item.key === type && item.permissions.every((permission) => can(permission as Permission))
    && businessReportAllowed(runtime, item.key, item.category)
  );
  const financialAllowed = isFinancial && can('reports.financial') && financialView
    && businessFinancialViewAllowed(runtime, financialView);
  const validDates = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
    && !Number.isNaN(Date.parse(`${from}T12:00:00Z`)) && !Number.isNaN(Date.parse(`${to}T12:00:00Z`))
    && from <= to && allowedDates.from === from && allowedDates.to === to;

  return (
    <section className="min-w-0 space-y-3" dir={isAr ? 'rtl' : 'ltr'} data-testid="report-full-page">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm">
        <div className="flex items-center gap-2">
          <FileBarChart className="h-5 w-5 text-ui-primary" />
          <div>
            <h1 className="text-lg font-black text-ui-text">{isAr ? 'التقرير التفصيلي' : 'Detailed report'}</h1>
            <p className="text-xs text-ui-muted">{from} — {to}</p>
          </div>
        </div>
        <button type="button" onClick={() => navigate('/reports')}
          className="inline-flex items-center gap-2 rounded-lg border border-ui-border px-3 py-2 text-xs font-bold text-ui-text">
          <ArrowRight className="h-4 w-4" />{isAr ? 'العودة إلى لوحة التقارير' : 'Back to reports overview'}
        </button>
      </header>
      {!validDates ? (
        <p role="alert" className="rounded-xl border border-ui-danger/30 bg-ui-danger-soft p-5 text-sm text-ui-danger">
          {isAr ? 'الفترة المحددة غير صحيحة أو خارج نطاق الوصول المسموح.' : 'Invalid dates or history outside your allowed access.'}
        </p>
      ) : financialAllowed ? (
        <FinancialReportsPage hideViewPicker compactFilters />
      ) : !isFinancial && allowedReport ? (
        <ReportsPage key={allowedReport.key} controlledReportType={allowedReport.key as ReportType}
          controlledFrom={from} controlledTo={to} standalone />
      ) : (
        <p role="alert" className="rounded-xl border border-ui-border bg-ui-surface p-5 text-sm text-ui-muted">
          {isAr ? 'التقرير غير متاح لهذه الصلاحيات أو نوع النشاط.' : 'Report unavailable for your permissions or business type.'}
        </p>
      )}
    </section>
  );
}
