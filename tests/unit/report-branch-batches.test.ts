import { describe, expect, it } from 'vitest';
import { readBranchBatches } from '@/features/reporting/readBranchBatches';

describe('multi-branch report reads', () => {
  it('processes 120 branches in order with at most six concurrent reads', async () => {
    const branches = Array.from({ length: 120 }, (_, index) => index + 1);
    let active = 0;
    let peak = 0;
    const results = await readBranchBatches(branches, async branch => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return branch * 2;
    });
    expect(results).toEqual(branches.map(branch => branch * 2));
    expect(peak).toBe(6);
  });

  it('stops before starting subsequent batches on a failing branch', async () => {
    const started: number[] = [];
    await expect(readBranchBatches(Array.from({ length: 25 }, (_, i) => i), async branch => {
      started.push(branch);
      if (branch === 2) throw new Error('branch read failed');
      return branch;
    })).rejects.toThrow('branch read failed');
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
