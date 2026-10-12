# Phase 8C — bounded scheduled ERP outbox worker

## Implemented
Migration `20261011133446_phase8c_scheduled_verified_event_worker.sql` enables `pg_cron` when installed/available, and schedules job `erp-domain-outbox-v2` once a minute, running the existing Phase 8B private verifier with batch size 20. The job executes as `postgres`. It creates no browser-callable or service-role-callable procedure, modifies no historical journals, and performs no external notifications. Failed events stay quarantined pending an explicit reviewed retry, with max 5 attempts.

In CI's stock PostgreSQL image `pg_cron` is unavailable. The migration intentionally skips scheduling there, while integration tests verify the conditional behavior, absence of API permissions, and receipt provenance/quantity guards. A production check is *required* to prove that the job was actually scheduled and run.

## Production acceptance on 2026-10-11
- Supabase project `hvqlkapynjfjikqithvd` accepted migration version `20261011133446`.
- `pg_cron` 1.6.4 installed; `cron.job` jobid=1, active=true, username=postgres, schedule `* * * * *`.
- Independent `cron.job_run_details` entries showed two successful runs (UTC 13:35 and 13:36).
- At installation, there were zero pending, failed, or delivered live outbox events. These successes prove real scheduling, **not** ingestion of real new events.
- The 72 integration tests and Playwright checks from PR #88 predate this phase; run new PR checks before merge.

## Verification and operations
Check `cron.job`, `cron.job_run_details`, `private.erp_domain_delivery_health_v2`, and `private.erp_domain_event_receipts_v2` as DB owner. Confirm that newly committed valid domain events are DELIVERED and persist exactly one receipt, while malformed sources remain FAILED and require reviewed retry. The processor does not forward events to external systems; that is a later integration.

To pause this *specific* job without damaging unrelated cron workloads, execute `select cron.unschedule('erp-domain-outbox-v2');` as an authorized operator. Do not uninstall the shared `pg_cron` extension. Keep rollback/remediation auditable.

This is a DB-local verified event consumer, **not** a provider-backed AI worker and not a general distributed at-least-once delivery system.
