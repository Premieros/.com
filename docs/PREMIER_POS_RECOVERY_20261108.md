# Premier POS recovery — 2026-11-08

Status: **DRAFT / partial P0 frontend repair only**.

Repository: `Premieros/.com`. Production database: `hvqlkapynjfjikqithvd`.
Source comparison: Johna’s POS PR #550 (read-only reference; no foreign project credentials or database connections embedded).

## Purpose
Prevent a closed or cancelled restaurant order from being rehydrated into a live cashier workspace after authorization; refresh the current branch's live order snapshot after a Realtime subscription or reconnection, because Realtime does not replay missed messages.

## Code and evidence
- `src/features/pos/services/posOrders.ts`: fail closed with `ORDER_CLOSED` / `ORDER_CANCELLED` after fetching the authoritative order status, before loading or restoring item rows.
- `src/features/pos/services/posRealtime.ts`: on `SUBSCRIBED`, schedule an already existing debounced branch-scoped refresh for active listeners; no new polling, retrying payments or re-sending kitchen commands. Coalesces repeated subscription notices.
- `tests/unit/posRecoveryGuards.test.ts`: terminal status rejection and no subsequent reads; subscription status handling, listener cleanup, deduped refresh, no writes.
- Full unit/CI results must be checked at exact HEAD before marking this change verified. Only isolated tests, not live customer operations.

## Exclusions / unfinished P0 work
This does **not** fix the financial server authority gap: Premier's production `_prepare_kitchen_sale_settlement` and `enqueue_cloud_open_order_print` lack Johna's `ORDER_NOT_FULLY_SENT` guard. Server-side transaction-locked checks and negative tests are still required, with an operator-reviewed SQL candidate and separate explicit approval **before any production schema change**.

No change to production database, RLS, accounts, stock, sales, customers or any printer. Nothing is merged to main. No claim that all POS bugs or the 24-item remediation list are complete.

## Rollback
Revert the two narrowly scoped frontend commits and this associated test/documentation on this PR; no data migration to reverse.

## Relationship to canonical master work log
The canonical `docs/PREMIER_MASTER_WORK_LOG.md` currently lives on the Windows Draft branch, not production `main`. A cross-reference should be appended there without copying its entire unmerged 45KB history into this independently based POS PR.

## Additional frontend checkout safeguards (same draft)
- `src/features/pos/pages/PosWorkspacePage.tsx`: cashier now blocks opening payment, completing payment, and its open-check printing actions when a live order visibly has unsent lines; direct sales without an active kitchen order are not blocked by this rule.
- `src/features/pos/utils/unsentCheckoutGuard.ts` and `tests/unit/posUnsentCheckoutGuard.test.ts`: deterministic guard and unit tests.
- `src/features/pos/hooks/usePosOrder.ts`: when an active order's authoritative settlement preview is missing, do **not** print a previously saved completed receipt as a fallback.
- UI guards are *defense in depth only*. A stale view or direct RPC can bypass frontend checks; the transactional SQL authority and printer enqueue guards remain a separate P0 task.
- Relevant commits: `d7728acc41369d4c498470d9df760d4b07e5da06`, `76f77afffea8e58e4de4f4de6b113f26c2ae1fbd`, `ea504141407e80293dd38bc394ceb5ae7b9e3ff3`, `64d0113ae8e4a427af70c761e00414e9440f4aeb`, `4e9f77cbca2a6c1d9679b9194b0f00351fde0243`.
- Initial Verify run `42494600453` failed before application tests at the repository-reference identity check, because the worklog named a foreign repository. Commit `ba2912a0218af27183b868cfa2a544946e11dc61` removed that foreign identifier; later Verify run `42494922183` must be checked independently. A CI green claim is **not** made by this line.
