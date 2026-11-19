# Premier POS operational health (first phase)

This is **diagnostic monitoring** and not a transaction engine. Its alerts do **not** reclassify customer-entered data mistakes as software defects.

## Rollout / architecture

- Database migration `20261119153000_pos_health_aggregate_monitor.sql` creates `private.pos_operational_health_samples` and `private.capture_pos_operational_health()`; the function is **not exposed to anon or authenticated roles**.
- On production pg_cron, the named schedule `premier-pos-operational-health` runs every 15 minutes. CI PostgreSQL without pg_cron skips scheduling; regression tests invoke the function directly in a rollback-only transaction.
- Every run checks a bounded **trailing 60 minutes**, except the closed-snapshot validity check (24 hours). Results consist of four **aggregate counts only**, with no customer names, invoice details, employees or identifiers. Each 15-minute bucket is overwritten on safe retry, never double-counted.
- Signals are `review` or `ok`, never automatically a proof of software defect. Operators investigate the originating ledger/source.
- The health sampler makes **no edits to sales, sale_payments, stock, journal, daily closes or customers**. Its only writes are its own history samples.

## Four signals

| Metric | Meaning | Interpretation |
|---|---|---|
| `split_tender_mismatch` | A recent split sale has too few tenders/methods, tender sum differs from paid, or a refund tender violates its own bounds | Transaction consistency review |
| `posted_journal_imbalance` | A newly posted journal has no lines or net debit-credit delta over 0.01 | Transaction consistency review |
| `overdue_fixed_day_close` | An active branch with fixed end time has an unclosed due business day more than 10 minutes past cutoff | Operational follow-up; it may be intentional because manual shift closure is required |
| `empty_closed_day_snapshot` | Recently closed day has missing/empty report JSON | Report snapshot integrity review |

## Important limits

The monitor is **not** a guarantee that every transaction was processed: a rolled-back failed sale does not create a sale and cannot be diagnosed from these tables alone. It does not see browser-only offline queues, provider payment outages, real printers, or user device crashes. Those require explicit client telemetry, provider-side reconciliation and delivery/alert routing with appropriate security review. Do not claim those are covered.

Performance is bounded to recent transaction windows and uses existing table models; track query plans/latency under realistic traffic and adjust sampling if needed. Keep financial/business data source-of-truth authoritative. Do not delete, rebuild or silently recompute prior-day financial snapshots.

## Operations

SQL check (privileged DBA only; do not expose credentials):
```sql
SELECT bucket_start, metric_code, category, affected_count, status
FROM private.pos_operational_health_samples
ORDER BY bucket_start DESC,metric_code
LIMIT 40;
```

The cron job itself must be checked for success **and** the four metric rows; an execution succeeding does not prove every business branch has closed. Configure responsible on-call/notification recipients separately before claiming active alert delivery.

## Follow-up phases

- Alert delivery with deduplication/escalation; do not send invoice or personal data.
- Client offline-queue age and POS action latency with consent, bounded retention and user-level permissions.
- Daily/monthly read-performance benchmarks before changing any costing or balance writer.
- AI agents remain read-only advisors until accounting and access tests demonstrate safety.
