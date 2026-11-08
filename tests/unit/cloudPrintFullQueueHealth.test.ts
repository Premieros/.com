import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  queries: [] as Array<{
    table: string;
    selected: string;
    options: { count?: string; head?: boolean };
    filters: Array<{ op: string; key: string; value: unknown }>;
  }>,
  unavailable: false,
  queryError: false,
}));

vi.mock('@/api', () => ({
  shifts: {},
  pos: {},
  supabase: {
    from(table: string) {
      const query = {
        table,
        selected: '',
        options: {} as { count?: string; head?: boolean },
        filters: [] as Array<{ op: string; key: string; value: unknown }>,
      };
      harness.queries.push(query);
      const builder = {
        select(field: string, options: { count?: string; head?: boolean }) {
          query.selected = field;
          query.options = options;
          return builder;
        },
        eq(key: string, value: unknown) { query.filters.push({ op: 'eq', key, value }); return builder; },
        in(key: string, value: unknown) { query.filters.push({ op: 'in', key, value }); return builder; },
        lt(key: string, value: unknown) { query.filters.push({ op: 'lt', key, value }); return builder; },
        is(key: string, value: unknown) { query.filters.push({ op: 'is', key, value }); return builder; },
        then(resolve: (result: { count: number | null; error: Error | null }) => unknown, reject?: (error: unknown) => unknown) {
          const isStale = query.filters.some((f) => f.op === 'in' && f.key === 'status');
          const value = {
            count: harness.unavailable ? null : isStale ? 225 : 22,
            error: harness.queryError ? new Error('permission denied') : null,
          };
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

import { getCloudPrintQueueHealthCounts } from '@/features/pos/services/cloudPrint';

const NOW = Date.parse('2026-11-08T10:00:00.000Z');

beforeEach(() => {
  harness.queries.length = 0;
  harness.unavailable = false;
  harness.queryError = false;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('full cloud print backlog health (read-only)', () => {
  it('counts ALL old jobs even when 225 exceed the recent queue 150-row limit', async () => {
    expect(await getCloudPrintQueueHealthCounts('branch-a')).toEqual({
      staleJobs: 225,
      unclaimedPendingJobs: 22,
    });
    expect(harness.queries).toHaveLength(2);
    for (const q of harness.queries) {
      expect(q.table).toBe('cloud_print_jobs');
      expect(q.selected).toBe('id');
      expect(q.options).toEqual({ count: 'exact', head: true });
      expect(q.filters).toContainEqual({ op: 'eq', key: 'branch_id', value: 'branch-a' });
      expect(q.filters).toContainEqual({ op: 'lt', key: 'created_at', value: '2026-11-08T09:50:00.000Z' });
    }
    expect(harness.queries[0].filters).toContainEqual({
      op: 'in', key: 'status', value: ['pending', 'claimed', 'printing'],
    });
    for (const required of [
      { op: 'eq', key: 'status', value: 'pending' },
      { op: 'eq', key: 'attempts', value: 0 },
      { op: 'is', key: 'claimed_at', value: null },
    ]) {
      expect(harness.queries[1].filters).toContainEqual(required);
    }
  });

  it('never queries a different branch or a missing branch', async () => {
    expect(await getCloudPrintQueueHealthCounts('  ')).toEqual({ staleJobs: 0, unclaimedPendingJobs: 0 });
    expect(harness.queries).toHaveLength(0);
    await getCloudPrintQueueHealthCounts(' branch-b ');
    expect(harness.queries.every((q) => q.filters.some((f) =>
      f.key === 'branch_id' && f.value === 'branch-b'))).toBe(true);
  });

  it('fails closed when scoped counts are denied or unavailable', async () => {
    harness.queryError = true;
    await expect(getCloudPrintQueueHealthCounts('branch-a')).rejects.toThrow('permission denied');
    harness.queryError = false;
    harness.unavailable = true;
    await expect(getCloudPrintQueueHealthCounts('branch-a'))
      .rejects.toThrow('CLOUD_PRINT_QUEUE_HEALTH_COUNT_UNAVAILABLE');
  });
});
