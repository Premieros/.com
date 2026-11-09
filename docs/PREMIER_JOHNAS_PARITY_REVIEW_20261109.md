# Premier operational parity review — 2026-11-09

**Write target:** `Premieros/.com` only. **Read-only reference:** Johna’s reference repository (read only). No Johna's commits, database changes, migrations or deployments were performed.

This review compares **behavioral invariants**; the Johna's raw-material costing model and permission policies cannot be copied into Premier without changing its inventory ledger, published-price history, accounting snapshots and organization/branch authority.

## Fixed in this Premier-only branch

1. **Atomic stock count** (Johna's #570 and later count fixes as inspiration): Premier's last installed writer uses `private.apply_unified_raw_movement_v1` for raw reductions, `private.remove_product_stock_non_fifo_v1` for product reductions, and journal posting. Four error-return paths inside the multi-item loop could commit earlier changes. New guarded migration converts **only post-write failures** into controlled exceptions that trigger PL/pgSQL subtransaction rollback while retaining the prior public JSON error code. The outer preflight failures still return without writing. No FIFO-to-last-price conversion or historical repricing was introduced.
2. **Kitchen screen reads are read-only** (Johna's #580/#583 as inspiration): remove the automatic `complete_stale_kitchen_orders` mutation from every KDS refresh. Overdue cards remain visible with a warning; only a permissioned explicit status button changes the order. Reject repeat clicks on the same order while a status write is in flight. Historical completed entries remain accessible. The legacy sweeper RPC remains available to the service role for controlled maintenance, but authenticated view-only clients no longer have EXECUTE permission; the frontend helper was removed.
3. **Dashboard timeout containment** (Johna's #604 as inspiration): distinguish an absent RPC (PGRST202, legacy fallback permitted) from permission errors, timeouts and malformed responses (no raw-sales query storm, retain last-known data with visible retry error).
4. **POS read failure containment** (Johna's #604/#550 as inspiration): all branch-scoped floor-plan reads must succeed before replacing the visible restaurant snapshot. The existing Premier `usePosRealtime` hook already retains the last successful snapshot on thrown errors; `fetchActiveOrders` now propagates errors from tables, active orders, operator names, order lines and send receipts instead of silently returning empty arrays.

## Required pre-production verification

**Do not merge or apply the SQL migration without:**
- Disposable-DB integration test with two count lines, injected second-line failure, verification that stock, batches, movement ledger, journal and count status all remain identical to before the failed RPC.
- Verify both branches: raw-material and finished-product adjustment failures; check role/RLS and `inventory.count.apply` authorization; verify success path posts balanced journal **once**.
- Verify installed `apply_stock_count(uuid)` body matches the guarded Premier baseline. On drift, migration must stop rather than overwrite new business logic.
- Test KDS against the installed `get_kitchen_queue` and explicit `set_kitchen_status` functions with two terminals, overlapping realtime refreshes, overdue cards, station-scoped users and new send after prior served work. Confirm `authenticated` cannot call `complete_stale_kitchen_orders` but `service_role` still can.
- Verify dashboard on timeout, missing RPC, partial multi-branch read and permission denial; no raw-sales fanout after non-compatibility failures.
- Verify active POS order/table reads preserve the last good scoped snapshot under timeout and RLS failures (including kitchen sends), and do not expose stale data after switching branches.

## Still not proven equivalent — separate, scoped work required

- **Johna's #597–603:** Latest-approved-price raw engine, historical count revaluation and debt reconciliation are different from Premier's published-price accounting and unified signed movements. Do not transplant physical ledger/cost SQL; audit Premier inventory vs accounting before any pricing changes.
- **Johna's #612/#596:** Period-close detailed historical reconciliation/export has no direct named counterpart in Premier; needs product specification and authoritative read contract instead of copying report RPCs.
- **Johna's #620–622:** Cross-branch expense and manufactured recipe visibility requires RLS impersonation tests in Premier's own tenant/branch model before changing grants or policies. The existing Premier expense policy has a permission/financial-scope gate; it does not establish complete parity.
- **Johna's #500:** Premier already has recovery of auth profile/transport failures but needs a separate audit of lazy-loaded bundle refresh and permission isolation.
- **Johna's #544/#550:** Premier has POS mutation locks and retry keys; separate multi-device integration tests are needed to verify settlement races and kitchen-send idempotency. No payment/checkout implementation was replaced here.

## Boundaries

- Changes are committed **only** to a Premier feature branch. Reference repo **not modified**.
- No production Supabase write, schema migration execution, or Vercel deployment.
- Passing source-contract/unit tests is not equivalent to proving transactional behavior against a real local PostgreSQL fixture.
