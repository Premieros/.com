import { describe, expect, it } from 'vitest';
import { scopeVisiblePrintQueueJobs } from '@/features/pos/services/printQueueDiagnostics';
import type { CloudPrintQueueRow } from '@/features/pos/services/cloudPrint';

const job = (branch: string): CloudPrintQueueRow => ({
  id:'test-job', branch_id:branch, kind:'kitchen',
  station_code:'kitchen', payload:{}, attempts:0,
  status:'pending', created_at:'2026-11-15T00:00:00Z',
});

describe('cloud print queue display isolation on branch switches', () => {
  const oldJobs = [job('branch-a')];

  it('shows only current branch jobs with current permissions', () => {
    expect(scopeVisiblePrintQueueJobs(oldJobs,'branch-a','branch-a',true)).toBe(oldJobs);
  });

  it('hides previously loaded jobs immediately when switching branch', () => {
    expect(scopeVisiblePrintQueueJobs(oldJobs,'branch-a','branch-b',true)).toEqual([]);
  });

  it('hides jobs when printer permission is revoked or a branch is deselected', () => {
    expect(scopeVisiblePrintQueueJobs(oldJobs,'branch-a','branch-a',false)).toEqual([]);
    expect(scopeVisiblePrintQueueJobs(oldJobs,'branch-a','',true)).toEqual([]);
  });

  it('rejects mixed-branch rows even if the loaded branch marker matches', () => {
    expect(scopeVisiblePrintQueueJobs([job('branch-a'),job('branch-b')],
      'branch-a','branch-a',true)).toEqual([]);
  });
});
