# BUNKER / Premier OS — operational go-live handoff
Checked: 2026-11-21
Owner: assigned by business management
Status: **TECHNICALLY PREPARED — NOT AUTHORIZED FOR LIVE ORDERS** (customer preview remains simulated).

## Scope and known implementation
- Premier OS: https://premieros-sage.vercel.app
- BUNKER standalone marketing website: https://bunker-ecru.vercel.app
- Public custom domain: https://bunker-egy.app (apex redirects to www; www is still assigned to the Premier Vercel project and rewritten to /bunker/index.html, **not** independently attached to the BUNKER project).
- BUNKER branch ID: `d56aae83-f1b3-4153-9224-87594500368d`.
- BUNKER customer QR menu: 15 catalog products adopted from former demo items on 2026-11-21 at their existing prices; checkout remains **simulation only** until staffing, recipe/inventory mapping, and real order operation are verified and the manager explicitly enables QR intake.
- Guest order intake, review and kitchen dispatch paths exist in Premier OS; the full chain has not yet been witnessed with live branch staff and devices.

## Technical evidence (2026-11-21)
- Earlier full GitHub Verify main: **success** (566 unit, 158 integration/RLS, 3 browser smoke); latest handoff safety regression and schema migration CI must pass before release sign-off.
  - TypeScript, lint, production build: success.
  - Unit/component tests: 566 passed.
  - DB integration + RLS tests (disposable PostgreSQL): 157 passed.
  - Playwright shell smoke: 3 passed. **These do not cover a real staff login → customer approval → KDS workflow.**
- Production DB **read-only** checks: zero orphan sale items/payments/journal lines, zero duplicate invoice groups, zero unbalanced posted journals, zero raw-stock-versus-batch discrepancies; five negative raw balances all belong to another branch (johna's Cleopatra), not BUNKER, and require separate physical sign-off. Production has zero recorded sales/journal entries in the audited snapshot, so this is not proof of live sale/accounting functionality.
- Identity audit: 29 active staff profiles missing matching auth identities; 7 missing identities have privileged profile roles; 4 branches lack active organization memberships; BUNKER has no authenticated assigned branch-staff account or active authenticated org member. Do **not** create aliases or repoint UUIDs automatically.
- Database changes that had been applied manually are now versioned as:
  - `supabase/migrations/20261121090000_bunker_branch_website_settings_handoff.sql`
  - `supabase/migrations/20261121090100_bunker_qr_demo_and_live_gate_handoff.sql`
  - `supabase/migrations/20261121090200_pos_negative_stock_policy_handoff.sql`
  - `supabase/migrations/20261121090300_bunker_adopt_menu_and_keep_preview.sql`
  - `supabase/migrations/20261121090400_bunker_handoff_warehouse_and_order_activation_gate.sql`
  Verify the latest migration CI replay is successful before treating the schema as reproducible.

## Completed handoff preparation (2026-11-21)
- [x] 15 BUNKER catalog products adopted with provisional existing retail prices and English product descriptions; no demo flags remain.
- [x] One empty active warehouse created: **BUNKER Main Stock**, with **zero fabricated stock balances**.
- [x] Five active menu categories all route to the existing active kitchen station `main`. Kitchen supervisor must confirm and adjust this route if needed.
- [x] Server-side BUNKER-specific activation gate now requires nonzero product costs, real authorized branch staff identities/membership, active warehouse, valid kitchen routing and active tables; it has no impact on other branches.
- [x] Branch settings show itemized readiness blockers for authorized managers.
- [x] Acceptance worksheet: [`BUNKER_MENU_STAFF_UAT_ACCEPTANCE.md`](./BUNKER_MENU_STAFF_UAT_ACCEPTANCE.md) — price approvals, recipe/cost sign-off, staff roster and real device/UAT signatures.

## Mandatory business actions (in order)
- [ ] **Branch owner approves menu:** real product list, category assignment, product image rights, retail price/currency, modifiers, tax settings, available inventory/recipe and kitchen routing. The former demo products are now catalog products with unchanged provisional prices. Owner must still validate prices, costs, recipes, taxes, and menu accuracy before taking live orders.
- [ ] **Authorized identity roster:** branch owner provides the staff roster and role permissions; verify existing Supabase auth identities, active organization membership, branch access, and POS order review permissions. Fix the 29 unmatched users only after owner verifies each person. Do not merge accounts by email alone.
- [ ] **Separate domain project:** Vercel operator removes both `bunker-egy.app` and `www.bunker-egy.app` from `premier.os` and attaches them to `bunker` (keep the same DNS; verify apex-to-www redirect and HTTPS). Independently check `/admin`, `/#/settings`, and unknown routes on the custom domain do not reveal Premier admin; ensure `ORDER NOW` resolves only to the BUNKER QR page.
- [ ] **Photo/social/theme approval:** upload actual rights-cleared images and real social links through Premier settings; select and save light/dark; check the public site and QR page on mobile and desktop. Default demo images, empty links and dark mode are not brand approval.
- [ ] **Kitchen and stock setup:** confirm that `main` is the intended kitchen routing for all five BUNKER categories; perform real opening stock count and register all recipes, UOMs, costs and purchases; 15/15 product costs are currently zero and none has recorded recipes or components. Five negative raw balances are in another branch and require a separate controller review.
- [ ] **Device UAT (isolated test shift, approved):** log in as a branch-authorized cashier/reviewer; QR check-in/table selection; submit order; verify notification; accept/reject; send to KDS; mark ready/served; settle via cash/card; receipt/print; shift close; cancellation/refund; duplicate submit; offline/reconnect; role and branch isolation. Use a staging branch or a test transaction with an approved reversal procedure; do not inject fake financial records into production.
- [ ] **Restore rehearsal:** verify encrypted backup, perform timed restore in isolated environment, document actual RPO/RTO, and test monitoring and rollback.
- [ ] **Sign-off:** business owner, cashier lead, kitchen lead, and technical QA sign date/time with screenshots/log links. Only then enable BUNKER real customer ordering in branch settings.

## Live order activation gate
The 15 former demo items were adopted as catalog products on 2026-11-21, without creating inventory balances, recipes or payment records. A single empty warehouse is now registered. **QR intake remains disabled.** The preview is read-only/simulated. The server refuses activation if staff/warehouse/cost/kitchen checks fail, and manager approval and witnessed E2E UAT remain necessary even once those checks pass.

## Release acceptance record
| Gate | Current state | Owner | Evidence needed |
| --- | --- | --- | --- |
| App build/unit/db/browser CI | Previous pass; verify latest handoff commit | Developer / QA | Full green Verify main URL |
| Branch staff identities & memberships | BLOCKED | Business owner | Authorized roster, verified auth + branch access |
| Approved prices, costs and recipes | BLOCKED — 15/15 costs zero | Restaurant manager | Signed approval of current provisional prices, full recipe/stock readiness |
| Customer → reviewer → KDS UAT | NOT VERIFIED | POS & kitchen supervisors | Recorded end-to-end rehearsal |
| Domain project separation | INCOMPLETE | Vercel admin | Both domains attached only to BUNKER project |
| Images, themes, social links | NOT CONFIGURED | Brand owner | Approved assets and links |
| Five negative balances in another branch | SEPARATE REVIEW | Stock controller | Physical reconciliation sign-off |
| Backup restore / rollback | NOT VERIFIED | Operations | Recovery test and signed RPO/RTO |
| BUNKER empty stock warehouse | CREATED | Inventory lead | Opening physical count and posted stock balances |

**Release decision:** No live handoff authorization until all BLOCKED and NOT VERIFIED gates are closed.
