# PremierOS — performance hangs, tampering, and optional code prompts

Date: 2026-11-23. Scope: development branch only, no production deployment, no production DB writes.

## Verified and fixed in branch

- `PageProgressLoader` used an *artificial* progress bar which saturates at 92% and previously had no stall message or operator-controlled recovery. It now offers a clearly labelled manual page reload after 15 seconds. The watchdog is cancelled when page loading completes, and **never** automatically resubmits checkout, orders or payments.
- The timeout is a recovery UX fix, **not a network-layer fix** and **not proof** that the application cannot hang elsewhere.
- Source contract tests cover the watchdog and cleanup.

## Areas requiring anti-tampering review

- `CashierDiscountApprovalCard` reacts to an `approval_requests` Realtime status change and invokes an `onApproved` callback. Verify that the *final pricing and checkout mutation RPCs* re-check approver permissions, approval scope, and monetary limits on the server. A client callback is not authoritative proof.
- `SettingsContext` caches global and branch settings under browser-wide keys. Audit cross-user cache isolation; never let cached settings grant security permissions or decide approval policy. UI cache is not a trusted authorization source.
- `get_my_kitchen_stations` currently returns all active non-cashier stations to an authorized branch user who has no explicit station assignments. Treat this as a separate KDS permission concern and do not silently change access before a tested rollout.
- SQL/RPC must independently enforce branch, role, idempotency, amount, and transaction integrity regardless of what a React form displays.

## User requirement: do not request an additional code unless enabled in Settings

Treat optional **extra verification or approval codes** as **OFF by default**. Display such a prompt only when the appropriate explicitly enabled server-backed option applies to that actor, branch and action. The server must enforce the very same setting at the final mutation. UI-only toggles are bypassable.

**No blanket disabling of actual sign-in credentials or session recovery security is authorized:** `LoginPage` separately supports employee PIN *as a login method*, and the public QR visitor recovery PIN protects transfer of a visit to a different device. These are distinct from optional extra confirmation codes. The exact code workflow the owner intends to make optional must be confirmed before changing authentication or recovery RPCs.

A protected config migration, explicit Settings UI toggle, and both on/off access-control tests are required before implementing this workflow. Do not force a verification prompt when a confirmed optional configuration is disabled, or silently bypass a server-required secret when enabled.

## Follow-up hardening staged in PR (not deployed)

- Discount manager-approval UI now snapshots the submitted type and value, locks inputs while pending, and consumes an approved request once per open component session. This prevents client UI drift and duplicate notification handling but is **not** server-side authorization.
- Read-only DB check found `public.guard_sale_discount()` attached to `public.sales` **BEFORE INSERT only**. The authenticated `sales` UPDATE policy permits updates for users with `sales.manage` or POS-admin within a permitted branch, and the role has UPDATE table privilege. Therefore discount changes made via UPDATE had no equivalent trigger permission check (other RPC/trigger constraints may apply).
- Added **unapplied migration** `20261123120000_guard_sales_discount_updates.sql`, introducing an UPDATE-of-discount guard requiring `pos.discount` or POS-admin for positive discount changes. This migration requires integration testing of authorized adjustment workflows before any production application.
- **Remaining financial attack-surface work:** check direct changes to `total`, `paid_amount`, `tax_amount`, `status` and sale items versus authoritative RPCs; verify approval request ownership, consumption and expiry. Neither the React patch nor the narrow migration proves full anti-tamper security.

## Sales UPDATE attack-surface audit — latest read-only verification

- `public.sales` is RLS-protected: direct `INSERT` is `WITH CHECK (false)`; authenticated `UPDATE` is permitted for branch-scoped users with `sales.manage` or POS admin. Table-level UPDATE privileges remain granted to `authenticated`, subject to RLS.
- Live `sales` triggers include: discount guard **INSERT only**, employee-only credit guard on selected fields, work-authorization mutation guard on **all updates**, and other INSERT controls. The existing work-authorization guard does not by itself imply per-column financial immutability.
- `SalesPage.saveSaleEdit` uses a protected `change_sale_payment_method` RPC for payment changes, then performs direct `supabase.from('sales').update({ customer_id, status, notes })` for permitted metadata edits. Investigate whether arbitrary status transitions can falsely mark a sale returned/completed without a proper refund/accounting RPC.
- No UI-only fix can secure arbitrary PostgREST calls. Before deploying a migration, inventory supported financial mutation RPCs and implement server-enforced transition/field protections with SQL integration tests. Direct `UPDATE` of `total`, `paid_amount`, `tax_amount`, `refunded_amount` and invoice status remains a **review item**, not proven fully safe.
- The newly staged discount-update trigger is a narrow defense-in-depth change; **do not treat it as comprehensive anti-tamper protection**. The migration is intentionally not applied.

## Direct financial-write lockdown (staged, never applied to production)

- The sale metadata editor no longer exposes arbitrary status transitions or sends `status` in a direct `sales.update`. Marking a sale returned belongs to the protected refund procedure.
- Live schema inspection found the `authenticated` role has table-level UPDATE on **all** `sales` columns, and TRUNCATE; RLS limits accessible rows, **not writable columns**. Ordinary users could attempt updating protected fields on rows their roles can manage.
- Draft migration `20261123130000_limit_direct_sales_update_columns.sql` revokes broad authenticated UPDATE and TRUNCATE, granting only `customer_id` and `notes`. Settlement linkage is preserved by elevating the already-installed `sync_sale_source_order_from_kitchen_event` trigger to owner execution, retaining its branch/equality guards, with PUBLIC EXECUTE revoked.
- Contract tests and `tests/sql/sales_direct_write_privileges_gate.sql` check the intended privilege set. **Before applying to production**, test all checkout, refunds, payment-method changes, archive, kitchen settlement event linkage, and cross-branch access on an isolated project. Security-definer changes need an explicit trigger-input forgery review as well.
- This is an **unapplied** security migration: do not infer production has these protections.

## Additional performance and test enforcement

- `SettingsContext` now parses its initial local cache once, scopes localStorage keys by authenticated user, resets cached UI state on session-owner changes, rejects stale asynchronous fetch responses, and preserves cached data when either fetch fails.
- `SettingsRepository` now accepts optional user-scoped IndexedDB/localStorage keys. Active SettingsContext writes use those scoped keys; legacy unscoped callers remain compatible and should be audited separately before claiming all offline caches are fully isolated. Cached settings are never a substitute for server permission checks.
- `ManualPaymentApprovalsModal` now refreshes its pending-transfer queue every 15 seconds **only while the document is visible**, and immediately on return; manual refresh remains available.
- The sales privilege SQL gate is now included in **both** disposable Postgres workflows: Fast Verify and Verify main. Do not treat the migration as deploy-ready until their latest head-SHA results pass, including DB replay.
- The additional-code requirement remains **unimplemented pending selection of the precise operation code flow**. Do not disable login credentials, guest session transfer recovery, or server-side authorization while making optional extra prompts opt-in.

## Release constraints

No Vercel deployment, preview, spend-setting change, or promotion without fresh specific human approval. Existing production remains unchanged. CI green is not equivalent to browser E2E verification.
