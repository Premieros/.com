# Premier OS — unified branch websites, QR and POS acceptance

Date: 2026-11-21. Scope: **all current and future branches**; BUNKER is the first acceptance example, **not a fork or branch-specific product**. No change to production data or QR activation is authorized by this document.

## P0 — sales and inventory must work
- Product with no linked raw material or operational recipe: create/link exactly one raw material with the **same display name** (scope identity by organization/branch and product; don't merge unrelated materials based only on name). Deduct quantity atomically on actual sale at its configured unit conversion. Allow negative balance when starting from zero. Do not double-deduct on retries, resend-to-kitchen, or repeat requests. Reversal/refund restores quantity exactly once; partial quantities, modifiers, transfers and splits must reconcile.
- Existing valid recipe: deduct its defined ingredients instead; do not auto-create a substitute material.
- Zero cost is permitted as a temporary **cost valuation**, not a reason to block valid sales; use last approved price when available, zero otherwise. Never fabricate opening inventory, item costs, or accounting transactions.
- Replace any **BUNKER-only** hard-coded QR activation gate demanding nonzero product cost and preexisting inventory/recipe with **shared branch-scoped behavior**. Do not merely remove the gate before confirming the auto-link-and-deduct path actually works and after migration tests pass. Keep server-side authorization, valid menu, order routing and safety protections.
- Acceptance: sale from stock 0 for unlinked item -> single matching material -> balance -N; repeat same sale ID -> unchanged; refund -> balance restored; existing recipe -> component deductions only; concurrent sales and cross-branch access -> no duplication/leakage; CI, integration and manual device UAT.

## P1 — one stable QR code per physical location/branch
- **Exactly one persistent QR per branch / venue, NOT one per table or per order.** Generated once and stored, reprint/download as often as needed.
- Opens that branch's public customer website/menu. Table selection, if enabled, happens **inside the website**. Each visitor has an isolated temporary basket/order session.
- Updating menu, prices, orders or business day does not rotate QR. Preserve redirect compatibility if custom domain changes; choose a stable platform-owned redirect identifier rather than making a third-party custom domain an immutable QR dependency.
- Branch/domain association unique and checked server-side; no cross-branch order, KDS or financial leakage.

## P1 — website tenancy and domain controls
- One Premier OS codebase, shared site renderer and backend; **each branch gets its own website, domain, branding, menu, prices and enabled fulfillment modes**, isolated by branch IDs and RLS.
- A hostname maps exclusively to one branch at a time; ownership of a purchased custom domain remains with its owner. Do not repoint another branch's domain or expose Premier administrative routes through public website rewrites.
- Super admin has central management over all branches; branch users operate only within explicit scope and permissions.
- Design branch-scoped reads, pagination, caching and indexes for 100+ branches rather than global fetches.
- BUNKER domain `bunker-egy.app`: domain move from Premier's Vercel project to the BUNKER hosting context remains operationally pending; verify HTTPS, redirects, route scoping and rollback before changing DNS or project bindings.

## P2 — safe website live editor
- On the **public branch website**, display **Edit** only to an authenticated user entitled to edit that branch site, or super admin. Enforce the same permission at the server and storage layers.
- Inline edit **any editable text** while preserving typography/layout; replace images preserving aspect ratio and styling. Also edit links and labels.
- Preview, saved draft, publish and restore previous revision; publish should not require rebuilding/deploying on Vercel. Versioned branch-scoped content storage and approved media uploads.
- Changes must not alter POS business records or another branch's website. Test unauthorized edits and multi-branch isolation.

## P0 operational release: end-to-end selling
- Prove table/order creation, send to kitchen and notifications, KDS status, edits, split/merge/partial move, cash/card settlement, receipt printing, cash-up, expense/report consistency, refunds/cancellations, retry idempotency, offline recovery, roles and branch isolation.
- Run integration/staging tests before real branch UAT. Keep actual customer orders disabled until end-to-end customer-intake and server-side safety checks pass; do not fabricate employees, costs or stock.
- Employee roster spreadsheet and sign-off documents are **not** the definition of completion. Missing access configuration is a separate operational task; no fake identities.
- No risk to current branches' active selling, KDS or printing; stage changes, use reversible migrations, validate and roll back on regression.

## Priority execution order
1. Trace POS sale-to-stock event model, existing auto-material logic, idempotency and activation gate. Write failing regression tests for no-recipe/zero-stock sale and refund.
2. Implement generalized auto-material link plus atomic negative-stock movement; correct activation readiness without bypassing order security. Validate RLS, concurrents and 100-branch scale.
3. Consolidate branch QR into one stable venue-level record and test session/table choice.
4. Generalize domain-to-branch site routing; validate ownership isolation and BUNKER redirect.
5. Build shared inline content/media editor with draft/publish/restore.
6. Complete full POS/kitchen/printing/UAT and production release checks.

## Current verified mismatch
`supabase/migrations/20261121090500_bunker_live_stock_or_recipe_gate.sql` defines `qr_private.bunker_live_menu_ready()` with `cost_price > 0` and a pre-existing inventory/recipe/component/link requirement. This contradicts agreed business policy. Do not simply drop the checks without first guaranteeing safe stock auto-linking and correct financial event semantics.

Status: requirements documented; functional implementation and E2E acceptance **not yet verified**.
