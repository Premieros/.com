# Online warehouse inventory snapshots for offline POS — 2026-10-13

## Scope

The warehouse-scoped offline stock projection (PR #104) and pinned warehouse financial capture (PR #105) require trustworthy per-warehouse stock snapshots. This change adds **read-only online hydration** using the existing, permission-filtered `public.inventory` table and commits the resulting **local-only** cache atomically in IndexedDB.

Canonical repository: `Premieros/.com`. Production Supabase: `hvqlkapynjfjikqithvd`.

## Behavior

- When connected and the POS branch/order becomes active, and when the browser reconnects, verify the warehouse via the existing branch/order resolver. Then query `public.inventory` with **both** `branch_id` and `warehouse_id` filters, deterministic ID ordering and 500-row pagination.
- Do not change IndexedDB if any page errors, returns malformed data, has an unexpected branch/warehouse, or exceeds the bounded 100-page limit.
- Aggregate product inventory batches/rows by product ID **within the same warehouse**. Preserve explicitly returned zero or negative rows. Never synthesize zeros for missing products and never use a branch-wide product total as a warehouse quantity.
- Replace the given branch+warehouse's cached stock rows in **one IndexedDB readwrite transaction**, deleting their previous values and adding the complete new snapshot. Preserve other branches/warehouses and legacy branch-wide records. A failed transaction must not leave a partially refreshed cache.
- A valid zero-row authoritative response removes any stale warehouse-specific records so the product's quantity becomes **unknown**, not a guessed zero. It does not touch sales, pending outbox, local movement or journal stores.
- Existing offline checkout now refuses unknown warehouse stock if negative stock is disabled (PR #105). The server remains authoritative on replay.

## Current production limitation

A production read-only check confirmed `public.inventory` has 0 rows, `public.inventory_batches` 0 rows and there are 0 ready-type products as of this checkpoint. Consequently **this hydration will not make restaurant recipe products magically have a warehouse ready-stock quantity**; for those products the ready-stock projection remains `unknown`. Material/recipe consumption is handled in separate raw FIFO and kitchen workflows. Mapping recipe availability to raw BOM, per-warehouse quantities, and negative-stock policy requires a distinct designed and reviewed change.

**Avoid mistaking this stage for completion of all multi-warehouse offline inventory safeguards.** It is a safe source-to-cache pipeline for existing warehouse product stock rows only.

## Verification / boundaries

- Unit tests check duplicate lots, wrong branch/warehouse rejection, null/corrupt quantities, empty source, failed first page, failed later page, and single-warehouse selective replacement.
- Existing 129 unit / 76 isolated database tests and Playwright browser smoke are required on the final PR head.
- No SQL migrations, no production writes, no historic FIFO or GL repairs, no automatic reassignment of ownerless/unpinned outbox rows, and no provider-backed financial AI action.
