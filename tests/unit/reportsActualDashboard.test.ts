import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const layout = read('src/components/Layout.tsx');
const center = read('src/features/reporting/pages/ReportsCenterPage.tsx');
const dashboard = read('src/features/reporting/components/ReportsLiveDashboard.tsx');

describe('Reports screenshot correction', () => {
  it('restores Premier original application sidebar styling', () => {
    expect(layout).not.toContain('linear-gradient(180deg, #1a1d37');
    expect(layout).not.toContain('isReportsWorkspace');
    expect(layout).not.toContain('text-violet-300');
    expect(layout).toContain('location.pathname === APP_ROUTES.reports');
  });
  it('replaces linked showcase on actual reports route with four live panels', () => {
    expect(center).toContain('<ReportsLiveDashboard allowedReportTypes={allowedReportTypes} onSelectReport={selectOperational} />');
    expect(center).not.toContain('<ReportsShowcase');
    expect(center).toContain("requestedType && permittedOperational.some");
    for (const id of ['overview-sales-trend', 'overview-payment-mix', 'overview-products', 'overview-branches']) {
      expect(dashboard).toContain(`data-testid="${id}"`);
    }
    expect(dashboard).toContain('<AreaChart');
    expect(dashboard).toContain('<PieChart');
    expect(dashboard).toContain('<BarChart');
    expect(dashboard).toContain('<table');
  });
  it('uses authorized existing reporting services, Cairo range, safe missing states and no demo numbers', () => {
    expect(dashboard).toContain('loadSalesReportRows({');
    expect(dashboard).toContain('loadSalesByProductItems({');
    expect(dashboard).toContain('reporting.getSalesByPaymentReport({');
    expect(dashboard).toContain('requireFinancialReport(');
    expect(dashboard).toContain('history.clampRange(');
    expect(dashboard).toContain('scope.selectedBranchIds');
    expect(dashboard).toContain('reportDateRangeUtc(');
    expect(dashboard).toContain('businessDateISO(new Date(');
    expect(dashboard).toContain('netSaleAmount(');
    expect(dashboard).toContain('netSaleItemRevenue(');
    expect(dashboard).toContain('allocateSaleNetRevenue(');
    expect(dashboard).toContain('أكمل التالي');
    expect(dashboard).not.toMatch(/579,300|66,550|217,450|4,892/);
  });
});