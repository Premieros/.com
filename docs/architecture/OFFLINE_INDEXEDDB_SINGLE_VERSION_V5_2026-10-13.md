# Shared offline IndexedDB v5 upgrade — 2026-10-13

## Confirmed risk

Two modules opened the *same* `premier_pos_offline_db` using different schema versions:
- `src/core/offline/offlineStorage.ts`: `DB_VERSION=3`, used by financial offline sale outbox and cached catalog/stock.
- `src/core/repositories/LocalDatabase.ts`: `DB_VERSION=4`, used by local stock movements and stock balances.

Once v4 was created, a separate v3 `indexedDB.open` can reject with a `VersionError`, leaving queued sales unable to open. If v4 was initialized before the offline v3-specific `stock_map` store existed, the cache store was missing; the v4 repository upgrader did not create it.

## Additive fix

- **One authoritative upgrader and connection**: `openOfflineDb` re-exports `getLocalDb`; all callers use exactly the same database name, version and connection promise.
- **Schema v5** in `LocalDatabase`, with `stock_map` added if absent. Every existing v3/v4 store is preserved in-place, including `sales_queue`, `local_stock_movements`, `stock_balances` and the auth cache.
- Existing `onversionchange` closes an old connection to permit upgrades across open tabs.
- The queue schema is unchanged, **no queued sale is auto-synced, relabeled, deleted or assigned a new cashier**. Legacy ownerless records continue to be held by replay's fail-closed identity guard.
- A simulation test starts with v3 and v4 schemas containing a pending sale, upgrades using the real module entry points, verifies the shared v5 connection and required object stores, enqueues a second sale, then emulates a module reload and confirms both remain.

## Validation limits

The unit test is a stateful IndexedDB protocol emulator, **not** a real-browser crash/restart guarantee. The standard CI Playwright browser smoke checks ensure the application still loads. A follow-up real Chromium IndexedDB reopen/upgrade test with a seeded legacy profile remains appropriate before declaring all tab-crash cases exhaustively covered.

No remote SQL, schema migrations, stock history, FIFO or journal modifications. Canonical repository `Premieros/.com`; Supabase `hvqlkapynjfjikqithvd` is untouched by this change.
