import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useCan, type Permission } from '@/lib/permissions';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import { businessReportAllowed } from '@/core/organizations/businessRuntime';
import { REPORT_REGISTRY } from '../reportRegistry';
import { ReportsPage } from './ReportsPage';
import {
  CONSUMPTION_REPORT_LABELS, CONSUMPTION_REPORT_TYPES, isConsumptionReportType,
  type ConsumptionReportType,
} from '../consumptionWorkspace';

/**
 * A real consumption workspace using Premier's existing branch-scoped,
 * permission-checked report loaders. No separate costing calculations.
 */
export function ConsumptionReportPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { runtime } = useOrganizationModules();

  const permitted = CONSUMPTION_REPORT_TYPES.filter(type => {
    const report = REPORT_REGISTRY.find(item => item.key === type);
    return !!report
      && report.permissions.every(permission => can(permission as Permission))
      && businessReportAllowed(runtime, report.key, report.category);
  });
  const requested = params.get('type');
  const selected: ConsumptionReportType | null =
    isConsumptionReportType(requested) && permitted.includes(requested)
      ? requested : permitted[0] ?? null;

  const selectReport = (type: ConsumptionReportType) => {
    if (!permitted.includes(type)) return;
    const next = new URLSearchParams(params);
    next.set('type', type);
    setParams(next);
  };
  const label = (type: ConsumptionReportType) => {
    const item = CONSUMPTION_REPORT_LABELS[type];
    return ar ? item.ar : item.en;
  };

  return (
    <section className="min-w-0 space-y-3" dir={ar ? 'rtl' : 'ltr'} data-testid="consumption-report-workspace">
      <header className="rounded-xl border border-ui-border bg-ui-surface p-4 shadow-ui-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black text-ui-text">{ar ? 'تقارير الاستهلاك' : 'Consumption reports'}</h1>
            <p className="mt-1 text-xs text-ui-muted">
              {ar ? 'نفس بيانات وصلاحيات تقارير Premier، دون حساب تكلفة بديل.' : 'Uses Premier report data and permissions, without a shadow costing engine.'}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/reports')}
            className="rounded-lg border border-ui-border px-3 py-2 text-xs font-bold text-ui-text">
            {ar ? 'العودة إلى التقارير' : 'Back to reports'}
          </button>
        </div>
      </header>
      {!selected ? (
        <p role="alert" className="rounded-xl border border-ui-border bg-ui-surface p-4 text-sm text-ui-muted">
          {ar ? 'لا توجد تقارير استهلاك متاحة لصلاحياتك ونوع نشاط المؤسسة.' : 'No consumption reports are available for your role and business type.'}
        </p>
      ) : (
        <>
          <nav aria-label={ar ? 'أنواع تقارير الاستهلاك' : 'Consumption report types'}
            className="flex flex-wrap gap-2 rounded-xl border border-ui-border bg-ui-surface p-3">
            {permitted.map(type => (
              <button key={type} type="button" onClick={() => selectReport(type)}
                aria-current={selected === type ? 'page' : undefined}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${selected === type
                  ? 'border-ui-primary bg-ui-primary text-ui-primary-fg'
                  : 'border-ui-border bg-ui-page text-ui-text'}`}>
                {label(type)}
              </button>
            ))}
          </nav>
          <p role="note" className="rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2 text-xs text-ui-muted">
            {ar ? CONSUMPTION_REPORT_LABELS[selected].noteAr : CONSUMPTION_REPORT_LABELS[selected].noteEn}
          </p>
          <ReportsPage key={selected} controlledReportType={selected} standalone />
        </>
      )}
    </section>
  );
}
