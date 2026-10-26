# Controlled FIFO plan cleanup — 2026-10-23

Environment: Supabase project `hvqlkapynjfjikqithvd` linked to `.com` ONLY.

User explicitly authorized direct modification/cleanup of the project clone.

## Executed SQL (remote, data-only)
```sql
WITH removed AS (
  DELETE FROM public.raw_fifo_backfill_batch_plan p
  USING public.raw_fifo_backfill_runs r
  WHERE p.run_id = r.id AND r.status = 'cancelled'
  RETURNING p.run_id
)
SELECT count(*)::int AS deleted_cancelled_plan_rows,
       count(DISTINCT run_id)::int AS affected_runs
FROM removed;
```

Result: deleted 12,424 plan rows spanning 2 cancelled runs.
FK check: no tables had declared foreign-key constraints referencing public.raw_fifo_backfill_batch_plan.
Run-status counts before: applied 14,395; cancelled 12,424; prepared 20,062.
Verified after: applied 14,395 (3 runs); cancelled 0 (2 run headers preserved); prepared 20,062 (4 runs).
Total details: 46,881 -> 34,457 (~26.5% reduction in row count).
No journals, sales, inventory ledger, or batch stock were changed directly.

## Caveats
- This is **not** proof that no application logic or unmodelled references depended on cancelled-run details. Review callers and regression tests before adopting recurring retention.
- DELETE does not guarantee immediate on-disk file shrinkage.
- SQL was executed directly; record this change in ops audit. Do not blindly rerun in production.
- Next: review backfill retention policies and code paths, source-of-truth duplication, POS event fanout and tenant relationship graph with rollback test fixtures.
