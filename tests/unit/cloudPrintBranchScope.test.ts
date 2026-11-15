import { describe, expect, it } from 'vitest';
import { ensureCloudPrintQueueBranchScope, type CloudPrintQueueRow } from '@/features/pos/services/cloudPrint';

const job = (branchId: string): CloudPrintQueueRow => ({
  id: 'job-1',
  branch_id: branchId,
  kind: 'kitchen',
  station_code: 'kitchen',
  payload: { text: 'test' },
  attempts: 0,
  status: 'pending',
  created_at: '2026-11-15T00:00:00Z',
});

describe('cloud print queue branch isolation', () => {
  it('accepts empty results and jobs from the explicitly selected branch', () => {
    const rows = [job('branch-a')];
    expect(ensureCloudPrintQueueBranchScope([], 'branch-a')).toEqual([]);
    expect(ensureCloudPrintQueueBranchScope(rows, 'branch-a')).toBe(rows);
  });

  it('rejects the entire response if even one job belongs to another branch', () => {
    const rows = [job('branch-a'), job('branch-b')];
    expect(() => ensureCloudPrintQueueBranchScope(rows, 'branch-a'))
      .toThrow('CLOUD_PRINT_BRANCH_SCOPE_MISMATCH');
  });

  it('rejects missing selected branches and missing branch IDs in returned rows', () => {
    expect(() => ensureCloudPrintQueueBranchScope([job('branch-a')], ''))
      .toThrow('CLOUD_PRINT_BRANCH_SCOPE_MISMATCH');
    expect(() => ensureCloudPrintQueueBranchScope([job('')], 'branch-a'))
      .toThrow('CLOUD_PRINT_BRANCH_SCOPE_MISMATCH');
  });
});
