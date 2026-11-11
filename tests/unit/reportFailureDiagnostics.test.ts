import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyReportFailure, describeReportFailure } from '@/features/reporting/reportFailure';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

describe('report failures preserve source diagnostics safely', () => {
  it('uses an explicit FK for the real sales warehouse embed', () => {
    const loader = readFileSync(resolve(process.cwd(), 'src/features/reporting/services/reportCoreLoaders.ts'), 'utf8');
    expect(loader).toContain('warehouse:warehouses!sales_warehouse_id_fkey(name)');
    expect(loader).not.toContain('warehouse:warehouses(name)');
  });
  it('classifies native authorization errors', () => {
    expect(classifyReportFailure({ code: '42501', message: 'permission denied' }, [first]))
      .toEqual({ kind: 'permission', code: '42501', branchId: null });
  });
  it('understands original financial RPC wrappers and selected branch identity', () => {
    const error = new Error(`FINANCIAL_REPORT_INCOMPLETE:sales_by_payment:${first}:42501`);
    expect(classifyReportFailure(error, [first])).toEqual({ kind: 'permission', code: '42501', branchId: first });
    expect(classifyReportFailure(error, [second])).toEqual({ kind: 'permission', code: '42501', branchId: null });
  });
  it('distinguishes database mismatch, timeouts and missing payloads', () => {
    expect(classifyReportFailure({ code: '42703' }, []).kind).toBe('schema');
    expect(classifyReportFailure({ code: 'PGRST200' }, []).kind).toBe('schema');
    expect(classifyReportFailure({ code: 'PGRST201' }, []).kind).toBe('schema');
    expect(classifyReportFailure({ code: '57014' }, []).kind).toBe('timeout');
    expect(classifyReportFailure(new Error('FINANCIAL_REPORT_INCOMPLETE:income:' + first + ':EMPTY_RESULT'), [first]).kind).toBe('source');
  });
  it('gives an understandable reason and action without displaying technical error codes', () => {
    const cases = [
      { code: '42501', phrase: 'صلاحية', next: 'مدير النظام' },
      { code: 'PGRST201', phrase: 'إعداد التقرير', next: 'مسؤول النظام' },
      { code: '57014', phrase: 'وقتًا أطول', next: 'فترة أقصر' },
      { code: 'UNKNOWN', phrase: 'جميع نتائج', next: 'إعادة تحميل' },
    ];
    for (const { code, phrase, next } of cases) {
      const failure = classifyReportFailure({ code }, [first]);
      const message = describeReportFailure(failure, 'ar');
      expect(message.title).toContain(phrase);
      expect(message.action).toContain(next);
      expect(`${message.title} ${message.action}`).not.toContain(code);
    }
    const english = describeReportFailure(classifyReportFailure({ code: '42501' }, []), 'en');
    expect(english.title).toContain('cannot view');
    expect(english.action).toContain('administrator');
  });

  it('keeps customer messages free of raw technical fields in report JSX', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');
    const kpis = readFileSync(resolve(process.cwd(), 'src/features/reporting/components/ReportsExecutiveKpis.tsx'), 'utf8');
    const financial = readFileSync(resolve(process.cwd(), 'src/features/accounting/pages/FinancialReportsPage.tsx'), 'utf8');
    expect(page).toContain('describeReportFailure(reportFailure');
    expect(page).not.toContain('رمز الخطأ:');
    expect(page).toContain('retry-failed-report');
    expect(kpis).toContain('راجع بيان');
    expect(kpis).toContain('/reports/view?section=financial');
    expect(financial).toContain('describeReportFailure(reportFailure');
    expect(financial).toContain('retry-financial-report');
    expect(financial).not.toContain('رمز الخطأ:');
  });

  it('never exposes a foreign branch identifier', () => {
    expect(classifyReportFailure(new Error(`FINANCIAL_REPORT_INCOMPLETE:income:${second}:42501`), [first]).branchId).toBeNull();
  });
});
