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
    expect(center).toContain('<FinancialReportsPage hideViewPicker />');
    expect(center).toContain('<ReportsPage controlledReportType={activeReport}');
    expect(center).toContain('data-testid="premier-reports-directory"');
    expect(center).toContain('lg:grid-cols-[236px_minmax(0,1fr)]');
    expect(center).toContain('dir="ltr"');
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
    expect(showcase).not.toContain("supabase.from(");
    expect(showcase).not.toMatch(/(?:579,300|66,550|4,892)/);
  });

  it('uses the existing detailed-report handlers for header actions', () => {
    expect(center).toContain('onActionsReady={setReportActions}');
    expect(center).toContain('reportActions?.exportExcel()');
    expect(center).toContain('reportActions?.print()');
    expect(center).toContain('reportActions?.save()');
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
  });
});
