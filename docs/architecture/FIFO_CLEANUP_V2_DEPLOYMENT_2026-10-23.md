# FIFO cancelled plan cleanup v2 — deployed 2026-10-23

Supabase .com project: `hvqlkapynjfjikqithvd`
Applied migration name: `controlled_cancelled_fifo_plan_cleanup_v2`.

The new function `private.cleanup_cancelled_fifo_plan_v2(p_run_id uuid,p_execute boolean default false)`:
- Locks the run header with FOR UPDATE
- Requires status exactly `cancelled`
- Returns eligible row count for dry-run (default)
- On execute, deletes only `raw_fifo_backfill_batch_plan` rows belonging to the selected cancelled run
- Stores deleted count/time in `raw_fifo_backfill_runs.summary.cancelled_plan_cleanup_v2`
- Uses SECURITY INVOKER; EXECUTE revoked from PUBLIC, anon, authenticated, granted to service_role
- Must be invoked only from trusted backend operations, **never expose service_role to a frontend**
- Does not replace prepare/apply/reverse FIFO functions.

Validation from database:
- Both cancelled runs: preview success, eligible_rows=0, because 12,424 cancelled plan rows were cleaned earlier.
- Prepared run: refused with RUN_NOT_CANCELLED.
- has_function_privilege: anon=false, authenticated=false, service_role=true.

Pending: isolated transaction-based execute-path and concurrency regression tests, review of callers, runtime monitoring and integration into a reviewed admin backend if desired. No execute-path destructive test has been performed.