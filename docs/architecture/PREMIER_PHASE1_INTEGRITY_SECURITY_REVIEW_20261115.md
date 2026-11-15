# Premier Phase 1 — Integrity and security review (2026-11-15)

## Scope and evidence rules

- This is a **read-only baseline** for later staged fixes, not a certification of the system or a request to rewrite balances.
- Organization `9ede3630-cfc4-401c-9e93-36437a8a907a` (displayed `الفرع الرئيسي`) is **experimental** per owner. Do not classify its historical deletion trials, orphan references or historic costing artifacts as product defects without independently reproducible isolated tests.
- Exclude that organization from general production data anomaly metrics; do not exclude any reproducible application-level behavior from testing.
- Never auto-correct posted journals, stock batches, FIFO debts or old cost snapshots without a separate, attributable finance-approved proposal.

## Warehouse-specific offline sale — verified code issue and guard

In `src/features/pos/services/payment.ts`, offline sales with negative stock disallowed already call `InventoryRepository.getWarehouseAvailableStock(productId,branchId,warehouseId)`. They fail closed for missing/expired warehouse-specific snapshots and missing captured warehouse. The sync engine preserves the originally pinned warehouse.

**Issue fixed by this PR:** `PosWorkspacePage.tsx` still displayed branch-aggregate IndexedDB stock in the warehouse-specific POS when the warehouse could not be resolved offline, or a warehouse-scoped server read failed. That was misleading even if the final payment guard failed closed. The stock display now stays empty/unknown rather than borrowing another warehouse's quantity. The authoritative warehouse-specific server read is unchanged. Regressions assert this behavior.

**Still needed:** independent end-to-end two-warehouse testing on physical terminals and network failures, with original pinned warehouses across cache upgrades and restart, per [#103](https://github.com/Premieros/.com/issues/103). The absence of a stock display is not an assertion of zero physical stock.

## Cost policy / FIFO

Business rule recorded in [#124](https://github.com/Premieros/.com/issues/124): price inventory consumption using the latest *published* material price as of the event, or zero when none, rather than FIFO valuation; keep warehouse-scoped quantities independent from cost valuation.

Read-only PostgreSQL inspection on 2026-11-15:
- Both overloads of `public._raw_remove_fifo` **still exist**; the warehouse-aware overload still references `raw_fifo_debts`. Therefore do not claim FIFO has been fully removed.
- Pricing functions including `_raw_cost_for_costing`, `get_product_costing_detail` and `get_sales_component_reconciliation_report` reference the published-price context helper.
- Other routines still reference FIFO debts or material batches for operational or historical functions. Do not drop tables/functions/ledger records until full caller, trigger, source-event and accounting impact mapping succeeds.

**Required before changes:** isolated exercises of sale, kitchen send, purchase and return, production/BOM, stock counts, transfers, negative stock policy, journal balance, idempotent reversal and old-data compatibility; then a separate reviewed migration. See [#124](https://github.com/Premieros/.com/issues/124) and [#100](https://github.com/Premieros/.com/issues/100).

## Security

The 2026-11-15 Supabase advisors reported:
- 46 RLS-enabled tables with no policies (possibly intentionally inaccessible); a direct privilege check found **zero** such public tables with SELECT granted to anon or authenticated. Do not turn on broad policies just to clear warnings.
- 279 authenticated-executable SECURITY DEFINER function advisories require entry-point authorization review; not necessarily 279 vulnerabilities.
- One anonymous-executable SECURITY DEFINER function, `public.register_trial_tenant`, wraps tenant registration and is deliberately public-facing; review rate limits, validation, cross-tenant authorization and replay before modifying privileges.
- One leaked-password-protection setting advisory. Review in Supabase Auth settings.
- Performance advisories: 179 unindexed foreign keys, 19 RLS initplan, 82 multiple permissive policy, 163 unused indexes. Prioritize measured critical-path fixes, not blind index creation/deletion.

No permissions or RLS policies are altered by this PR.

## Accounting, performance and acceptance gates

- Positive-data, non-vacuous CI fixtures for posted journal, raw stock and sales cost are pending [#82](https://github.com/Premieros/.com/issues/82). Do not count only empty-fixture checks as full validation.
- Performance acceptance [#125](https://github.com/Premieros/.com/issues/125): benchmark 10/50/100 simultaneous cashiers, keyset reports and p50/p95/p99 checkout timings, multi-tenant access and lock contention.
- Historical source/journal mismatches in the experimental organization are not product defects without an independent reproduction.
- Complete this phase only after costing migration, warehouse E2E acceptance, least-privilege RPC review, positive-data financial regression and measured load run. A green CI on this PR is **only** proof of this specific warehouse display regression.

## Safe rollout

1. Merge the guarded UI fix only after lint/types/unit/build, full disposable PostgreSQL regression and browser smoke.
2. Observe real warehouse-specific POS availability in a safe test branch; avoid manipulating financial data to manufacture a demo.
3. Split cost and security runtime changes into individually reversible migrations, with finance/operator approval where balances or posted entries could change.
