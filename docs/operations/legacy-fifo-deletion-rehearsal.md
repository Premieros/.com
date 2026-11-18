# Legacy FIFO deletion: preflight and isolated rehearsal (NOT execution approval)

## Current scope (read-only Supabase observation, 2026-11-18)
Production project: `hvqlkapynjfjikqithvd`. The historical `raw_fifo_debts` table has **8,718** rows, all `legacy_fifo`, including **6,459** open and **2,259** settled rows. Linked objects: **3,093** `raw_fifo_settlements` (CASCADE, **191** linked to open debts), **36** `raw_fifo_debt_rebase_snapshots` and **54** `raw_fifo_debt_rebase_settlement_snapshots` (both RESTRICT). **146** negative raw-material balance records remain and will not be repaired by deleting debts.

## Run a read-only snapshot
Use secrets from a trusted runner only, never commit or paste credentials.

```bash
SUPABASE_PROJECT_REF=hvqlkapynjfjikqithvd \
SUPABASE_DB_URL="$SECURE_DATABASE_URL" \
node scripts/readiness/audit-legacy-fifo-deletion.mjs --confirm-project=hvqlkapynjfjikqithvd > fifo-deletion-preflight.json
node --test scripts/readiness/audit-legacy-fifo-deletion.test.mjs
```

Preflight output is aggregate-only. It **never authorizes deletion**. No backup is created by this command.

## Required before any destructive production action
1. Obtain an independently verified **production data backup** (not merely a schema-only Supabase preview branch), including debts, settlements, rebase snapshots, FIFO batches, inventory ledger, journal entries and stock balances; prove a successful restore to a **separate** environment with current production data. Record RPO/RTO, backup/restore ID, exact schema version and replay cutoff.
2. Inventory and accounting owners sign the immutable before-snapshot totals and approve a defined scope (open-only vs all legacy). Do not assume that 6,459 open debts equals all 8,718 historical records.
3. In the isolated copy, review `_raw_fifo_settle_receipt`, `_raw_remove_fifo`, `private.canonical_inventory_balances`, the two RESTRICT snapshot tables, and the CASCADE settlement table. Deleting only the parent debt rows is **not** sufficient. Resolve historical settlement/rebase references explicitly while preserving source ledger/sales/journal evidence and historical costs.
4. Simulate deletion **only** on that restored copy. Compare before/after balances, oversold batches, ledger entries, stock projections, journal balancing, past COGS and purchase receipt settlement. Confirm no future receipt double-allocates or silently ignores a remaining shortage.
5. Apply appropriately tested functional changes and tests to the isolated environment. Decide how negative inventory and outstanding oversold batches remain represented; never zero inventory by fiat.
6. Record exact affected row IDs/counts and a fully executable restoration or compensating strategy; require independent approval, maintenance window, access restrictions, and operation cutoff. No generic cascade, constraint disabling, or speculative mass updates.
7. Only then separately authorize production execution, with scoped transaction, preconditions and no automatic commit if counts differ. Post-change: rerun accounting, inventory, security and end-to-end cashier/inbound stock tests.

## Important
A Supabase development branch ordinarily applies migrations **without production records**, so creating one does not by itself test historical debt deletion. This PR creates no DB branch, export, backup, migration or deletion. A clean CI build is not release approval.
