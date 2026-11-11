import { describe, expect, it } from 'vitest';
import { canonicalReportCurrency, sharedReportCurrency } from '@/features/reporting/reportCurrency';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('reports currency and detail selection', () => {
  it('recognizes production Egyptian pound aliases without exchange conversion', () => {
    expect(canonicalReportCurrency('EGP')).toBe('EGP');
    expect(canonicalReportCurrency(' L.E ')).toBe('EGP');
    expect(canonicalReportCurrency('ج.م')).toBe('EGP');
    expect(sharedReportCurrency(['EGP', 'L.E', 'EGP'])).toBe('EGP');
  });

  it('does not add truly mixed or missing currencies', () => {
    expect(sharedReportCurrency(['EGP', 'USD'])).toBeNull();
    expect(sharedReportCurrency(['EGP', null])).toBeNull();
    expect(sharedReportCurrency([])).toBeNull();
  });

  it('renders selected operational and financial report name in detail route', () => {
    const detail = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportFullPage.tsx'), 'utf8');
    const hub = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsCenterPage.tsx'), 'utf8');
    expect(detail).toContain('selectedReportTitle');
    expect(detail).toContain('allowedReport?.title');
    expect(detail).toContain('financialNames[financialView]');
    expect(detail).toContain('controlledReportType={allowedReport.key as ReportType}');
    expect(hub).toContain('navigate(`/reports/view?type=${target}&from=${draftFrom}&to=${draftTo}`)');
    expect(hub).toContain('setPendingReport(event.target.value)');
  });
});