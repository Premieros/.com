# Offline POS replay attribution and stock projection — 2026-10-13

## Verified code-path risks addressed

The canonical repository `Premieros/.com` contains two distinct offline financial enqueue paths: `SalesRepository.enqueueSale` stores `created_by_user_id`, but `OfflineContext.queueSaleForOffline` did not. `OfflineSyncEngine.syncAll` requires an exact owner match with the active session to protect cashier attribution on shared terminals. Missing owner rows were consequently replay-blocked.

`SalesRepository.markSaleSynced` previously removed the sale outbox row **before** local sale movements. A tab crash between these awaited operations could leave orphan local stock deductions.

`InventoryRepository.getEffectiveAvailableStock` and `getBranchStockMap` previously skipped *all* pending queued sale items whenever **any** local movement had the same invoice reference. Partial movement writes (sale queue persisted first, movements written one by one) could make a second product appear to have stock it no longer has. A cross-branch invoice collision or a stale/synced movement could also hide an unsynced sale deduction.

## App-only changes

- `OfflineContext.queueSaleForOffline` now requires an existing session owner **before enqueue**, stores `created_by_user_id` on each new record and fails closed if the session is unavailable. Legacy rows remain typed as optional owner and are **not** silently adopted under another cashier.
- `SalesRepository.markSaleSynced` clears matching local movements before dropping the confirmed outbox row, matching the already-safe sync engine's sequence.
- Both inventory projection methods call a pure `getUnrecordedQueuedSaleDeductions`, which reconciles **per branch, per sale, per product** and deducts only the sale quantity not represented by unsynced local sale movements. It handles multi-line invoices, partial movement persistence, absent movements and cross-branch invoice collisions.
- Unit tests cover ownerless rejection, branch isolation, repeated product lines, confirmed/synced movements and partial crash state.

## Explicit limits and safe follow-ups

No Supabase migrations, data writes, RLS, journal or stock-history adjustments; no auto-adoption of legacy ownerless sales. An already ownerless item must remain held for manual reconciliation with its originating cashier and supporting invoice evidence, not transferred to the currently logged-in operator.

Potential future hardening: ensure `offlinePosManager.enqueueSale` legacy localStorage queue is not treated as financially replayable; add IndexedDB-backed end-to-end crash/restart tests; audit warehouse-specific cached quantities in multi-warehouse branches. Never claim true backend delivery solely from a local sale enqueue.

Recorded inventory review exceptions (8 classified cases and 0.3000 outstanding Smouha mismatch) remain manual-only pending accounting provenance.
