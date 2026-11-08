import { describe, expect, it } from 'vitest';
import { summarizePrintQueueHealth } from '@/features/pos/utils/printQueueHealth';

const NOW = Date.parse('2026-11-08T06:00:00.000Z');

describe('cloud print queue health (read-only)', () => {
  it('detects pending old jobs without starting or completing them', () => {
    const jobs = [
      { status: 'pending', attempts: 0, claimed_at: null, created_at: '2026-11-07T12:00:00.000Z' },
      { status: 'pending', attempts: 2, claimed_at: '2026-11-08T00:00:00.000Z', created_at: '2026-11-08T05:20:00.000Z' },
      { status: 'printing', attempts: 1, created_at: '2026-11-08T05:00:00.000Z' },
      { status: 'pending', attempts: 0, created_at: '2026-11-08T05:59:00.000Z' },
      { status: 'submitted', attempts: 1, created_at: '2026-10-01T00:00:00.000Z' },
    ];
    expect(summarizePrintQueueHealth(jobs, NOW)).toEqual({
      staleJobs: 3,
      stalePendingJobs: 2,
      unclaimedPendingJobs: 1,
      oldestStaleAt: '2026-11-07T12:00:00.000Z',
    });
    expect(jobs[0].status).toBe('pending');
  });

  it('ignores completed, invalid timestamp, and recent entries', () => {
    expect(summarizePrintQueueHealth([
      { status: 'failed', created_at: '2026-10-01T00:00:00Z' },
      { status: 'pending', created_at: 'invalid' },
      { status: 'pending', created_at: '2026-11-08T05:52:00Z' },
    ], NOW).staleJobs).toBe(0);
  });

  it('returns no stale jobs for an empty queue', () => {
    expect(summarizePrintQueueHealth([], NOW)).toEqual({
      staleJobs: 0, stalePendingJobs: 0, unclaimedPendingJobs: 0, oldestStaleAt: null,
    });
  });
});
