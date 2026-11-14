# Premier QR table ordering — review and staging guide

Status: draft implementation; no hosted schema changes or deployments authorized by this change.

## Reviewed baseline

- Repository `Premieros/.com`, main commit `320326ea85452e144f90f9190a472196726939a5`.
- Read-only inspection of `.com` Supabase project `hvqlkapynjfjikqithvd` confirmed the live columns, function bodies, pricing/ownership triggers, and RLS policies for dining tables, products, orders and order items.
- Existing POS uses `create_order` / `update_order`, order-item pricing and tax triggers, and separate kitchen-send / settlement operations. The floor plan treats empty order shells as non-operational.
- No new guest access is granted to those tables. No inventory, payment, kitchen dispatch or print operation occurs during guest submission or staff acceptance.

## Staff and guest flow

1. After review, apply `20261114001719_premier_qr_table_ordering.sql` to an isolated staging copy first, and deploy the application against that staging database. Deploy the migration before the new frontend; ordinary cart saves now use `qr_save_order`.
2. A user with `floor_plan.manage` opens the active-orders/table center and expands **إعداد منيو ورموز QR**. Publish the complete list of customer-facing products; existing published selections are loaded automatically. Nothing is published by default.
3. Select a table and generate its code. Download the PNG and print it. Generating again revokes the previously printed link. Disabling also revokes it. Codes are returned once; only their SHA256 hashes are stored.
4. The code opens `/#/qr/<random capability>`, independently of the authenticated staff shell. Guests select whole quantities and optional notes, and submit without logging in. This initial version supports base products; products with mandatory modifier selections are excluded.
5. The POS and table center show a branch-scoped pending count, refreshed every five seconds, with visible failure state. The POS workspace is notification-only so accepting cannot discard its unsaved cart. Staff accept or reject from the table center.
6. Acceptance requires branch access, an active staff profile and `pos.order.edit`. Creating a new table order additionally requires `pos.order.create`. Adding to another operator's order requires the existing `can_manage_other_pos_orders` permission boundary. Acceptance opens the existing POS order; the operator sends it through the existing kitchen workflow.

## Integrity and security

- Private schema tables have RLS enabled, no API-role table privileges, and no row policies. Narrow public invoker wrappers call explicitly granted private definers with fixed empty search paths. Staff functions validate the database-backed user and permissions, never editable JWT user metadata.
- The capability is two independent random UUIDs (over 240 random bits). It binds to one table and branch. Invalid, inactive, moved or disabled tables/branches fail closed. The public menu returns only published product IDs, names, descriptions and prices, plus a table label.
- Guest payloads are bounded to 30 distinct products, whole quantities 1–99, 300-character notes and 16 KB. The database permits ten new requests per table per minute and at most twenty pending requests; retries do not consume that allowance. Expired pending rows must be rejected by staff to clear them.
- Idempotency is unique per table, token generation and client request UUID. A canonical payload is retained; changed payload reuse fails. Guest retry results expose only the request ID and status. Ambiguous network retries retain their exact key and payload in session storage, including across reloads.
- Intake and acceptance read prices from branch-owned active published products. Both reject a stale quoted price. Acceptance locks product rows and relies on the existing authoritative item triggers; any failure rolls the entire transaction back, keeping the request pending.
- Table-row locks serialize QR intake/acceptance. A drift-checked patch adds the same table lock to native `create_order` before its existing occupancy check, closing its race with QR creation. Ambiguous multiple effective orders fail closed.
- A request submitted to an already occupied table retains that order ID. Closing or moving that order before acceptance requires a fresh request. Pending requests expire for acceptance after 30 minutes; rejection remains available. Static printed codes are bearer capabilities, not proof of the guest's physical presence; staff review remains required.
- Identically configured, undiscounted same-price lines can receive quantity increments without altering kitchen-sent quantities. A conflicting discounted or differently priced configuration stays separate and receives a QR request reference in its note, keeping POS cart keys distinct. Previous discounts and branch tax remain governed by existing triggers.
- Acceptance increments `orders.qr_revision`. Both POS full-cart save paths send the revision from the hydrated order. The guarded save and canonical `update_order` reject outdated or missing revisions for QR-touched orders. Staff must reopen stale workspaces before saving. Other POS workflows retain their existing permission, ownership and kitchen guards.
- Polling uses the existing staff session and server branch authorization. Switching branches discards prior results; the public entry uses a separate nonpersistent anonymous client and does not load staff providers.

## Verification

Use Node 22, matching existing CI. The computer's Node 26 runtime has a pre-existing jsdom/localStorage incompatibility. The existing SQL candidate contract test now normalizes CRLF before matching multiline SQL, allowing the same assertion on Windows and Linux.

```sh
npm ci
npm run typecheck:all
npm run lint
npm run test:unit
npm run build
node scripts/db/gen-contract.js --check
node scripts/db/verify-database-identity.js
node scripts/db/verify-project-references.js
```

`tests/unit/qr-database.test.ts` executes the actual proposed migration in an isolated PostgreSQL WASM runtime, with read-only snapshots of deployed create/update functions and pricing, ownership, permission and tax triggers. It covers authorization, public grants, branch isolation, payload validation, prices, retries, acceptance, totals, rejection, token revocation, limits, stale-cart protection, expiry, session turnover and existing discounts. Fixtures model only the ERP dependencies needed for this flow; they are not a complete staging copy.

`tests/components/qr-public-menu.test.tsx` covers anonymous entry, double-click protection, and an ambiguous network retry across reloads. Existing project unit/component tests also run.

The **QR table ordering security** workflow runs three real PostgreSQL 17 multi-connection tests: concurrent guest retries, concurrent staff acceptance, and native POS creation versus QR acceptance. It can initialize only a loopback database named `qr_test`; it never accepts the production database environment variable.

The dependency lock was already inconsistent on checkout (`npm ci` failed on missing optional platform packages). It was regenerated while adding pinned test-only `@electric-sql/pglite@0.3.14`; review the lock diff with the feature.

Before production approval, verify on a full staging copy: two staff browsers, branch switching, an occupied and vacant table, changed prices, required modifiers, duplicate retries, native kitchen send and inventory behavior, partial settlement, table turnover, stale workspaces and printing. The repository-wide database integration suite requires that complete isolated ERP database and must not be aimed at production for this review.

## Rollout and rollback

The PR is intentionally a draft. Publishing menu products and issuing codes are explicit staff actions after migration and frontend review. There is no production migration/deployment workflow in this feature.

For a frontend rollback, disable the table links first. QR-touched orders require the guarded save path, so retain the new frontend until those orders are closed, or review a database rollback that restores the original canonical function definitions and removes their revision guards. Do not drop request history or reset revisions to force an old cart through. Retain accepted request history for idempotency and audit.
