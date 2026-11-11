import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const menu = read('src/core/navigation/menu.config.ts');
const layout = read('src/components/Layout.tsx');
const center = read('src/features/reporting/pages/ReportsCenterPage.tsx');
const detail = read('src/features/reporting/pages/ReportsPage.tsx');
const showcase = read('src/features/reporting/components/ReportsShowcase.tsx');
const kpis = read('src/features/reporting/components/ReportsExecutiveKpis.tsx');
const full = read('src/features/reporting/pages/ReportFullPage.tsx');
const routes = read('src/app/routes.tsx');

describe('Dedicated Reports Center navigation and reference-inspired UI', () => {
  it('adds the primary sidebar entry, protected by the existing reporting permissions and route', () => {
    expect(menu).toContain("id: 'reports', route: APP_ROUTES.reports, icon: 'reports'");
    expect(menu).toContain("label: { ar: 'مركز التقارير', en: 'Reports Center' }");
    expect(menu).toContain("permissionsAny: ['reports.view', 'reports.financial'], group: 'main'");
    expect(layout).toContain('data-testid={`nav-item-${item.id}`}');
    expect(layout).toContain('location.pathname === APP_ROUTES.reports');
  });

  it('keeps the global sidebar styling identical across reporting and other routes', () => {
    // Reports can have their own internal directory, but must not restyle the app shell.
    expect(layout).toContain('const fullWidthContent = location.pathname === APP_ROUTES.dashboard || isReportsWorkspace');
    expect(layout).toContain('data-testid="app-sidebar" className=');
    expect(layout).toContain('className="text-ui-primary"');
    expect(layout).not.toContain('style={isReportsWorkspace');
    expect(layout).not.toContain("isReportsWorkspace ? 'text-violet-300'");
    expect(layout).not.toContain("isReportsWorkspace ? 'text-slate-300");
    expect(layout).not.toContain("isReportsWorkspace ? (isActive");
    expect(layout).toContain("isActive ? 'bg-ui-primary text-ui-primary-fg");
  });

  it('retains current reporting engines and places the report directory on the visual left', () => {
    expect(full).toContain('<FinancialReportsPage hideViewPicker />');
    expect(full).toContain('<ReportsPage key={allowedReport.key}');
    expect(center).toContain('data-testid="premier-reports-directory"');
    expect(center).toContain('data-testid="toggle-reports-directory"');
    expect(center).toContain('data-testid="reports-collapsible-directory"');
    expect(center).toContain('className="relative min-w-0"');
    expect(center).toContain('data-testid="premier-reports-content"');
    expect(center).toContain("dir={isAr ? 'rtl' : 'ltr'}");
    expect(center).toContain("report.permissions.every");
    expect(center).toContain('businessReportAllowed(runtime');
    expect(center).toContain('useBranchScope()');
  });

  it('only shows quick-entry report panels allowed by the existing registry', () => {
    expect(center).toContain('allowedReportTypes={allowedReportTypes}');
    expect(center).toContain('onSelectReport={selectOperational}');
    expect(showcase).toContain('PANELS.filter((panel) => allowedReportTypes.has(panel.report))');
    expect(showcase).toContain('data-testid={`report-shortcut-${panel.id}`}');
    expect(showcase).toContain('loadDashboardSalesSnapshot({');
    expect(showcase).toContain("can('dashboard.view')");
    expect(showcase).toContain("granularity: 'day'");
    expect(showcase).toContain('hasAuthorizedBranches');
    expect(showcase).toContain('data-testid="load-overview-charts"');
    expect(center).toContain('data-testid="apply-overview-dates"');
    expect(center).toContain('controlledFrom={dateRange.from}');
    expect(center).toContain('data-testid="reports-filters-popup"');
    expect(center).toContain('data-testid="reports-single-type-select"');
    expect(showcase).not.toContain("supabase.from(");
    expect(showcase).not.toMatch(/(?:579,300|66,550|4,892)/);
  });

  it('loads actual dashboard and accounting results on entry, never showing sample numbers', () => {
    expect(showcase).toContain('data-testid="reports-performance-summary"');
    expect(showcase).toContain('data-testid={`overview-kpi-${card.id}`}');
    expect(showcase).toContain('void load();');
    expect(showcase).toContain('current?.orderTypes');
    expect(showcase).toContain('reports-top-products-data');
    expect(showcase).toContain('if (error) return');
    expect(center).not.toContain('LEGACY_HIDDEN_REPORTS');
    expect(kpis).toContain('void run();');
  });

  it('uses the existing detailed-report handlers for header actions', () => {
    expect(full).toContain('standalone />');
    expect(routes).toContain('path="/reports/view"');
    expect(detail).toContain('data-testid="toggle-detail-filters"');
    expect(detail).toContain('exportExcel: handleExportExcel');
    expect(detail).toContain('print: handlePrint');
    expect(detail).toContain('save: handleSaveCustomReport');
  });

  it('preserves the existing income statement KPI completeness workflow', () => {
    expect(kpis).toContain('assessIncomeReadiness(');
    expect(kpis).toContain('income-completion-checklist');
    expect(kpis).toContain('income-branch-values');
    expect(kpis).toContain('يلزم استكمال البيانات');
    expect(kpis).toContain('bg-gradient-to-br');
    expect(center).toContain('onVerifiedTotal={setVerifiedIncome}');
    expect(showcase).toContain('verifiedIncome: IncomeKpiVerified | null');
    expect(showcase).toContain('comparableIncome.cogs');
    expect(showcase).toContain('comparableIncome.net_income');
  });
});
