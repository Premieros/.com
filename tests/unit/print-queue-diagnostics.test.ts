import { describe, expect, it } from 'vitest';
import {
  filterPrintQueueJobs, printQueueDiagnostics, printQueueJobSummary, isStalePrintJob,
} from '../../src/features/pos/services/printQueueDiagnostics';
import type { CloudPrintQueueRow } from '../../src/features/pos/services/cloudPrint';

const make = (overrides: Partial<CloudPrintQueueRow> = {}): CloudPrintQueueRow => ({
  id: 'job-1', branch_id: 'branch-a', kind: 'kitchen', station_code: 'main',
  payload: { text: 'طلب: 102\nطاولة: 7\nSecret line: do not copy' },
  status: 'failed', sale_id: 'sale-1', attempts: 2, created_at: '2026-11-15T09:00:00Z',
  last_error: 'Backend error: token=secret',
  ...overrides,
});

describe('print queue read-only diagnostics', () => {
  it('searches order, table, station, ticket ID without changing queue rows', () => {
    const failed = make();
    const active = make({ id: 'job-2', status: 'printing', station_code: 'bar', payload: { text: 'Order: 55\nTable: 2' } });
    const data = [failed, active];
    expect(filterPrintQueueJobs(data, 'failed', '102')).toEqual([failed]);
    expect(filterPrintQueueJobs(data, 'all', 'table')).toEqual([]);
    expect(filterPrintQueueJobs(data, 'active', 'bar')).toEqual([active]);
    expect(filterPrintQueueJobs(data, 'all', 'job-2')).toEqual([active]);
    expect(data).toEqual([failed, active]);
  });

  it('extracts English and Arabic order labels', () => {
    expect(printQueueJobSummary(make())).toEqual({ order: '102', table: '7' });
    expect(printQueueJobSummary(make({ payload: { text: 'Order: 55\nTable: 2' } })))
      .toEqual({ order: '55', table: '2' });
  });

  it('copies metadata but excludes ticket contents, customer details and backend errors', () => {
    const text = printQueueDiagnostics(make());
    expect(text).toContain('job_id: job-1');
    expect(text).toContain('branch_id: branch-a');
    expect(text).not.toContain('Secret line');
    expect(text).not.toContain('token=secret');
    expect(text).not.toContain('sale-1');
  });

  it('never mixes data from another branch supplied to the helper', () => {
    const local = make();
    expect(filterPrintQueueJobs([local], 'pending', '')).toEqual([]);
  });
});

it('flags only active jobs older than ten minutes without reprinting', () => {
  const now = Date.parse('2026-11-15T09:15:00Z');
  const pending = make({status:'pending'});
  const fresh = make({id:'fresh',status:'pending',created_at:'2026-11-15T09:10:00Z'});
  const submitted = make({id:'submitted',status:'submitted'});
  expect(isStalePrintJob(pending, now)).toBe(true);
  expect(filterPrintQueueJobs([pending,fresh,submitted], 'stale', '', now)).toEqual([pending]);
  expect(isStalePrintJob(make({status:'pending',created_at:'invalid'}),now)).toBe(false);
});
