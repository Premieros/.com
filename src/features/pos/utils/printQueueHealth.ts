/**
 * Read-only print queue health summary. Never start/complete/requeue jobs based
 * on this projection: old receipts and kitchen tickets can be unsafe to replay.
 */
export interface PrintQueueHealthRow {
  status: string;
  created_at: string;
  attempts?: number | null;
  claimed_at?: string | null;
}

export interface PrintQueueHealth {
  staleJobs: number;
  stalePendingJobs: number;
  unclaimedPendingJobs: number;
  oldestStaleAt: string | null;
}

export function summarizePrintQueueHealth(
  jobs: readonly PrintQueueHealthRow[],
  nowMs: number = Date.now(),
  staleAfterMinutes = 10,
): PrintQueueHealth {
  const cutoff = nowMs - Math.max(1, staleAfterMinutes) * 60_000;
  let staleJobs = 0;
  let stalePendingJobs = 0;
  let unclaimedPendingJobs = 0;
  let oldestStaleAt: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;

  for (const job of jobs) {
    if (!['pending', 'claimed', 'printing'].includes(job.status)) continue;
    const createdAtMs = Date.parse(job.created_at);
    if (!Number.isFinite(createdAtMs) || createdAtMs > cutoff) continue;
    staleJobs += 1;
    if (job.status === 'pending') {
      stalePendingJobs += 1;
      if ((job.attempts ?? 0) === 0 && !job.claimed_at) unclaimedPendingJobs += 1;
    }
    if (createdAtMs < oldestMs) {
      oldestMs = createdAtMs;
      oldestStaleAt = job.created_at;
    }
  }

  return { staleJobs, stalePendingJobs, unclaimedPendingJobs, oldestStaleAt };
}
