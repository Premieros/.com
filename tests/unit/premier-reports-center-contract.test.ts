import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const center = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsCenterPage.tsx'), 'utf8');
const report = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');

describe('Premier Reports Center: reuse, access and truthful presentation', () => {
  it('keeps the existing /reports entry and operational/financial report engines', () => {
    expect(center).toContain('Premier Reports Center');
    expect(center).toContain('data-testid="unified-reports-center"');
    expect(center).toContain('<ReportsPage controlledReportType={activeReport}');
    expect(center).toContain('<FinancialReportsPage hideViewPicker />');
    expect(center).toContain('navigate(`/reports?type=${type}`');
    expect(center).toContain("navigate(`/reports?section=financial&view=${view}`");
  });
  it('uses the existing registry and the organization and permission gates', () => {
    expect(center).toContain('REPORT_REGISTRY.filter');
    expect(center).toContain('report.permissions.every');
    expect(center).toContain('businessReportAllowed(runtime');
    expect(center).toContain('businessFinancialViewAllowed(runtime');
    expect(center).toContain('useBranchScope()');
    expect(center).toContain('branchScope.setAllBranches(true)');
    expect(center).toContain('branchScope.setSelectedBranchIds([event.target.value])');
    expect(center).toContain("can('reports.financial')");
    expect(center).not.toContain('from(\'sales\')');
  });
  it('only displays the existing report series and retains export/print permissions', () => {
    expect(report).toContain('setChartData(');
    expect(report).toContain('chartData.slice(0, 12)');
    expect(report).toContain('!reportError');
    expect(report).toContain("can('reports.export')");
    expect(report).toContain("can('reports.print')");
    expect(report).toContain('<ReportFilterBar');
    expect(report).toContain('<CustomReportBar');
  });
});