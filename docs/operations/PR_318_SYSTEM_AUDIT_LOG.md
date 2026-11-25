# PR 318 — System audit and remediation
Date: 2026-11-25. Scope: source review, disposable CI, production read-only checks. No production writes or deployment from this audit.

## Baseline
Commit a51b1ff5281033866771ef119b116969b6eb161a — Verify main run 45570391018: 148 unit/component files, 682 tests; 61 integration files, 168 tests; 3 browser smoke tests; lint, types, build and readiness gates passed. These are not operational acceptance.

## Confirmed code defects addressed in this batch
- Stock counts: edit ignored RPC error and business failure, reported success and could continue deleting lines. Check each response and stop, refresh after partial failure; preserve null versus zero, reject invalid quantities/duplicates, lock repeat actions.
- Transfers: late async average-cost response overwrote a whole stale draft; patch only matching lookup token, preserve quantity, reset source warehouse draft, reject pending/invalid/duplicate rows and guard repeated creation. Failed cost lookup requires manual cost entry.
- AR/AP: payment handlers lacked immediate reentrancy lock and save-time branch binding; stale invoice results could survive switching customers/suppliers. Scope invoice results, block premature/cross-branch saves and concurrent writes, handle unconfirmed outcome.
- Purchasing receiving: immediate lock and finite nonnegative quantity validation; refresh and close on uncertain outcome to avoid blind retry.
- New tests: operational-write-guards.test.ts. Full CI must pass for new head.

## Production read-only observations
2026-11-25 07:56 UTC; scripts/audit/erp-cross-domain-readonly.sql and scripts/audit/critical-integrity.sql.
- 15 of 16 BLOCK checks zero. One canonical inventory reconciliation row not MATCH: SEMI_FINISHED, exact warehouse, balance -1.0, batch sum -0.5, movement sum -0.5, movement delta -0.5. Trace negative batch and open debt overlap and actual physical stock before adjustment.
- Three stale active cloud print jobs (kitchen, pending, zero attempts, no reported error, created 2026-11-20 to 2026-11-21 UTC). Investigate routing/agent configuration and physical print evidence before retry; no blind reprint.
- Six negative raw balances allowed by settings (informational, not automatically a defect).
- Zero unbalanced journals, sale/payment mismatches, refund bounds violations, raw batch/warehouse discrepancies, FIFO pending adjustments, open shift duplicates, live kitchen inventory mismatches and listed branch mismatches.
- No production data changed.

## Remaining acceptance
Full authenticated UI workflows across product/recipe create-edit-reopen, purchase-receive-return, stock transfer/count/adjustment, manufacturing, cash/split/transfer sales/refunds, ledger/reconciliation, separate cashier/KDS/bar/QR sessions, offline reconnect/idempotency and performance, role/tenant access. Existing CI covers selected cases, not every workflow.
Atomic mixed composition writes and multi-line count edits still require a transaction-level design and failure tests. Browser smoke is not full operational acceptance. PR 317 dependency cleanup is independent; do not deploy or merge from this audit alone.

## Root cause of the manufactured balance mismatch — verified read-only
The current production `_deduct_inventory_unit_stock_policy` writes a negative batch, negative movement and a debt referencing that batch. One outstanding debt exists: 0.5, linked to a -0.5 batch for the same item/branch/warehouse. The linked debt exactly covers the negative batch. The current private view subtracts debt again: -1 instead of -0.5; batch and movement agree across all one current semi-finished scopes. This is a projection bug, not evidence requiring stock adjustment.

Candidate: `scripts/db/candidates/pr_318_semi_finished_balance_projection_NOT_FOR_PRODUCTION.sql`; test `tests/integration/pr318-semi-finished-balance-candidate.test.ts`. The candidate preserves the raw projection, total outstanding debt as a diagnostic, existing grants, and subtracts only debt not represented by the linked negative batch. Multiple debts linked to one batch are aggregated before overlap credit. This is not yet a canonical migration: Supabase CLI is not available in the current environment; generate a migration and verify CI before promotion. No production view or data changed.

## Continuation batch
Baseline 3b38d860e45ed47a900ac1f421b9b19326ddf9a2 / run 45572750030 passed 685 unit/component tests, 169 integration tests including the projection candidate, and 3 browser smoke tests.
- Product editor: verify product update returned a row and check JSON business success from replace_product_units (confirmed jsonb return in production metadata). Require raw recipe permission before creation.
- Product setup wizard: create raw recipe + product atomically using existing RPC; do not delete an already committed product on subsequent failure. Mixed group links and business attributes remain separate; verify raw rows. An approved migration is still needed for fully atomic mixed composition.
- Print queue: flag stale active jobs older than ten minutes, filter them, and scope displayed totals to visible branch; no reprint, cancel, or mutation of existing production jobs. Existing three pending tickets still require agent/printer verification.
- No production mutation, deploy, or merge. New CI required.
