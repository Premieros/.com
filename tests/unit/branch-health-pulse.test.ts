import { describe, expect, it } from 'vitest';
import { branchHealthSignals } from '../../src/features/admin/components/BranchHealthPulsePanel';

describe('branch health pulse metrics', () => {
  it('presents only supported live health counters without revaluing finance data', () => {
    expect(branchHealthSignals({
      active_shifts: 2, open_orders: 11, active_print_jobs: 3,
      stale_active_print_jobs: 1, pending_work_authorizations: 4,
    })).toEqual({ shifts: 2, orders: 11, printing: 3, stalledPrinting: 1, approvals: 4 });
  });

  it('does not propagate invalid values into the UI', () => {
    expect(branchHealthSignals({
      active_shifts: Number.NaN, open_orders: -5, active_print_jobs: Number.POSITIVE_INFINITY,
    })).toEqual({ shifts: 0, orders: 0, printing: 0, stalledPrinting: 0, approvals: 0 });
  });
});
