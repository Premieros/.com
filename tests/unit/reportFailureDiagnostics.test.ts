import { describe, expect, it } from 'vitest';
import { classifyReportFailure } from '@/features/reporting/reportFailure';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

describe('report failures preserve source diagnostics safely', () => {
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
  it('never exposes a foreign branch identifier', () => {
    expect(classifyReportFailure(new Error(`FINANCIAL_REPORT_INCOMPLETE:income:${second}:42501`), [first]).branchId).toBeNull();
  });
});
