# WBS-00: Windows Branch Server dependency discovery and gap report

Date: 2026-10-29 (Africa/Cairo). **Discovery evidence prepared; WBS-00 acceptance BLOCKED.** No implementation task is accepted by this report.

## Identity and audited baseline

| Identity | Verified value |
|---|---|
| Repository | `Premieros/.com` |
| Target development branch | `development/premier-windows-branch-server-plan` |
| Audited commit | `ab0900b342a4ddc16dd41052d18142d052b23106` |
| Plan's main baseline | `4e42bf4031b1419dba2992d0aaec2fd3aa0b5d1f` |
| Sole hosted Supabase project | `hvqlkapynjfjikqithvd` |
| Sole hosted Supabase URL | `https://hvqlkapynjfjikqithvd.supabase.co` |
| Management metadata, read on 2026-10-29 | Project ID/ref both match; dashboard name `john's 1`; status `ACTIVE_HEALTHY`; region `eu-central-1` |

The user requested continuation and explicitly asked to pin the database identity first. The management read used the connected `.com` account and the exact project ID. A dashboard display name is not a routing identifier. No database SQL, schema operation, production transaction, credential retrieval, enrollment, deployment or production data repair was performed. No other hosted database or repository was used as a source.

Scope follows [the product contract](../WINDOWS_BRANCH_SERVER_PRODUCT_CONTRACT.md), [work items](../WINDOWS_BRANCH_SERVER_WORK_ITEMS.md), [current work plan](../CURRENT_WORK_PLAN.md), [execution guardrails](../EXECUTION_GUARDRAILS.md) and [Branch Hub README](../../branch-hub/README.md). Read-only source discovery and synthetic local tests are the only business scope. WBS-01 ownership contracts and WBS-02 database selection remain undecided.

## Result

The existing cloud Premier UI and narrow browser offline-sale outbox can be reused as inputs to a future branch server. The audited Branch Hub cannot currently execute the complete local product. Its authenticated root returns JSON `404 NOT_FOUND`, its sync endpoint explicitly reports `onlineSyncImplemented: false`, and its installer only packages the Electron status window and Node server. Eight foundation tests pass; they establish queue/identity/backup behavior, not full local ERP correctness.

The frontend WAN-disconnection walk through Branch Hub stops at that first missing UI boundary. An independent lab walkthrough of the existing cloud frontend is also blocked by unresolved clean-install prerequisites; its generated API-contract check fails separately. Consequently WBS-00 has a concrete dependency map and evidence, but must not be marked ACCEPTED or used to skip Gate A.

## Inventory method and coverage

The [dependency appendix](WINDOWS_BRANCH_SERVER_DEPENDENCY_MATRIX_2026-10-29.md) lists all 77 `<Route>` registrations, including aliases, redirects and parameterized routes; they reference 70 route constants and 61 lazy screen imports. It also indexes direct cloud calls and pagination relation options across 345 source files. Counts are stored in [inventory-summary.json](windows-branch-server-audit-20261029/inventory-summary.json).

The inventory is lexical source evidence. Import reachability is an upper bound, not a runtime call trace. A blank route-table cell means calls are in services/hooks/providers or routed embedded screens, not that the screen works offline. Type arguments, computed relation names, conditional feature gates, PostgREST joins, function delegation and triggers need semantic review. All 575 migration files were indexed for function definitions; their 1,029 definitions include replacements/overloads and are not a claim about the currently deployed function set. No production schema parity was asserted.

## UI → API → data and WAN impact

The UI uses `HashRouter`: browser routes are `/#/pos`, `/#/purchases`, etc. A local asset server must serve the SPA root and bundled lazy chunks. The shared auth/role/module providers apply before protected screens, including hub/center pages that embed other pages.

| Screens / surface | Client boundary | Relation dependencies / authoritative effects to preserve | WAN loss at this baseline |
|---|---|---|---|
| `/login`, `/register` | `AuthContext`, auth SDK; registration screen RPCs | Auth identity, `users`; username lookup/login auditing; tenant registration remains central | New authentication/registration requires cloud. Cached profile is conditional hydration of an existing session, not offline credential verification |
| All protected routes | `ProtectedRoute`, `useCan`, `RolesContext`, `OrganizationModulesContext` | `roles`, `users`, `branches`, `organizations`; `get_organization_module_catalog`, `subscription_status` | Cached roles/profile/runtime may allow an existing session to continue. Expiry, revocation freshness and a new workstation have no accepted local authority |
| `/dashboard`, `/operations`, `/inventory-center`, `/procurement-center`, `/people`, `/finance`, `/administration`, `/v2` | Center/embedded pages, dashboard reporting RPCs | Domain dependencies below; chart/report datasets and module visibility | Navigation UI may render when cached; current operational figures and embedded writes remain cloud dependent |
| `/pos`, `/pos/:orderId`, delivery and drive-through redirects | `PosWorkspacePage`, order hooks, `floorPlan` domain, `posOrders.ts` | `orders`, `order_items`, `order_kitchen_sends`, `dining_tables`, products/customers/warehouses; `create_order`, `create_service_order`, `update_order`, `update_service_order`, order ownership RPCs | Existing order creation/update/transfer remains cloud authoritative. A browser sale queue does not provide a shared LAN order server |
| `/floor-plan`, kitchen aliases, `/kitchen-display` | `posOrders.ts`, `posRealtime.ts`, `kitchen.ts`, catalog domain | Cloud Realtime for orders/table state; `send_to_kitchen`, `set_kitchen_status`, consumption reversal, stale-order completion | New kitchen sends require RPC success before print dispatch. Realtime between terminals stops with WAN |
| POS normal settlement | `payment.ts` → `pos.processSaleIdempotent` → `process_sale_idempotent` | Server sale/order/shift validation; operation-key dedupe in `private.pos_sale_idempotency`; stock/BOM/cost and journal effects through delegated routines | Explicitly offline single-tender sale may enter browser IndexedDB with pinned owner, shift and warehouse. It is `pending_sync`, not a cloud-confirmed posting |
| POS split tender and manual transfer approvals | `processSaleSplitForOrder`; manual approval RPCs | `process_sale_split_idempotent`, `request_manual_payment_approval`, `manual_payment_approval_status`, `process_sale_manual_payment` | Explicitly blocked offline. Do not silently convert split/manual-approval transactions to a normal offline sale |
| `/sales`, refunds | Trade domain; paginated sales query | `sales`, `sale_items`, `sale_payments`; `process_refund`, `archive_returned_sale`; corresponding stock and accounting reversal behavior | Reads are cloud based; no local refund/finalization engine is implemented |
| `/products`, `/products/setup`, `/pricing`, modifiers, categories | Catalog domain and direct PostgREST; product image service | `products`, `categories`, `product_units`, components, `product_unit_links`, `v_current_sale_prices`; Storage bucket `product-images`; catalog/modifier RPCs | Previously cached POS catalog is limited reuse. Catalog/pricing writes, live costing and uploads need cloud; remote product images need local asset policy |
| `/inventory-units`, `/raw-materials`, recipe redirects, `/production` | Catalog/manufacturing pages and RPCs | `inventory_units`, `inventory_unit_recipes`, `raw_materials`, `recipes`, `recipe_items`, `inventory_unit_productions`; `produce_inventory_unit`, recipe update/delete | No complete local production/BOM posting or shared raw-material authority |
| `/stock-balances`, `/inventory`, `/warehouses` | Direct/paginated reads, inventory domain | `v_current_stock_position`, `inventory`, raw-material stock/warehouse relations, `warehouses`; `adjust_stock`, `adjust_raw_stock` | Authoritative balance views and adjustments require cloud; cached product availability is not equivalent |
| `/transfers`, `/stock-counts`, `/inventory-ledger`, batches/valuation/low-stock routes | Inventory domain, embedded screens | `warehouse_transfers`, `stock_counts`, inventory movements/batches; create/approve/apply count and transfer RPCs; stock valuation RPCs | Reads and mutations require cloud. No complete offline count/transfer/valuation cycle |
| `/waste-center`, `/kitchen-stations` | Waste page RPCs and station catalog APIs | `waste_entries`, `waste_categories`, `kitchen_stations`; station assignment/status controls | No accepted offline waste or station-configuration write path |
| `/costing` | Costing APIs and breakdown component | Cost snapshot/history/variance RPCs; raw/product batch reads; `set_item_standard_cost`, `set_raw_material_price` | Cloud costing evidence cannot be replaced by a cached price number. Local cost policy and parity remain WBS-01/02 decisions |
| `/purchases` | Trade domain | `purchases`, `purchase_items`, suppliers, warehouses; `process_purchase`, `update_purchase_invoice`, `delete_purchase_invoice`, `process_purchase_return` | No offline procurement engine; corrections/returns remain server-atomic operations |
| `/purchases/requests`, `/purchases/rfqs`, `/purchases/receiving` | Procurement domain | Purchase requests/RFQs/quotations/orders; `receive_purchase_order`; SQL writes receipt/item rows, inventory/UOM effects, purchase received counts and journal | No local receiving/posting engine. Preserve lock, permission and rollback behavior, including failure after receipt writes |
| `/customers`, `/suppliers`, `/business-records` | Party pages, `CustomerRepository`, records page | Party and business-record relations; sale/credit/account links | Customer cache has a limited local-create fallback; it is not a complete durable party conflict/sync contract. Supplier/record writes require cloud |
| `/shifts`, `/expenses` | Shift/accounting domain and closing services | `shifts`, `shift_operations`, expenses; `open_shift`, `close_shift`, `day_close`, `post_shift_expense`, reversal/edit RPCs | Cloud authoritative; offline sale capture still requires previously known shift. Full offline shift close, expense posting and reconciliation are absent |
| `/accounts`, `/opening-balances`, `/employee-receivables`, `/payments`, `/journal` and accounting redirect | Accounting domain and paginated lists | Chart of accounts, customer/supplier payments, journals/lines; `seed_opening_balances`, receive/pay functions, `post_manual_journal`, reversal/period-lock controls | No local double-entry posting/reporting engine. Unsynced browser sales do not appear as locally posted journals |
| `/treasury`, `/reconciliation` | Accounting domain | `treasury_accounts`, `treasury_transactions`, `bank_reconciliations`; transfer/deposit/withdrawal/matching/close RPCs | Requires cloud; no accepted offline cash/bank authority or period/treasury reconciliation |
| `/reports`, `/financial-reports`, `/audit-log` | Reporting RPCs and report pages | General ledger, trial balance, financial statements, stock statements, sales/aging/closing/cost reports; audit relations | Current cloud reports omit pending local browser events. Complete local unsynced reporting is absent |
| `/branches`, `/users`, `/permissions`, `/approvals`, `/settings`, `/super-admin`, `/system-health` | Admin/branches APIs; role writes; approval and settings pages | Organization/branch/user/role/settings/approval/subscription relations and admin RPCs | Central identity/permission changes and destructive admin operations have no local authorization/sync contract. Do not enqueue them as general offline writes |
| `/import-export`, global support launcher | Import/export services; support domain | Computed export relations and import RPCs; support conversations/messages | Cloud data extraction/import and support transport require WAN; export of already loaded local content is a different, narrower capability |

The table groups route families; exact aliases, embedded page entry points, direct calls and source locations are in the appendix. SQL-side financial/stock effects listed here identify invariants for later parity work, not permission to change them.

## Computed calls reviewed

Eight computed `supabase.from/rpc` call sites were found:

- FinancialReportsPage chooses `products` / `raw_materials` for selectors.
- CostBreakdownButton chooses `raw_material_batches` / `inventory_batches`.
- StockBalancesPage's pagination helper reads `v_current_stock_position` and `warehouses`.
- `usePaginatedRows` accepts page-provided `table` options, indexed separately. These include payments, reconciliations, RFQs, counts and transfer relations missing from direct `.from('literal')` counts.
- Import/export selects `branch_prices`, `inventory_movements`, `transfers`, `expenses` or `users` in its computed export branch. This is observed source behavior, not confirmation that each relation exists remotely.
- Product-image service has two bucket calls using the constant `product-images` (Storage, not public relations).
- The work-authorization provider calls RPC names through a generic wrapper. Its six distinct names are separately inventoried and are conditional on `VITE_WORK_AUTHORIZATION_GATE`; the provider's presence is not proof of backend deployment.

Nested PostgREST joins and SQL helper/trigger closure remain additional dependencies; do not use the literal count as a complete schema manifest.

## Existing local behavior and integrity boundaries

### Browser offline layer

- `LocalDatabase.ts` is the shared IndexedDB v5 upgrader. It contains catalog/reference stores, `sales_queue`, `orders_queue`, `stock_balances`, `local_stock_movements`, `outbox_operations`, `auth_cache` and settings. These are per-browser/origin stores, not the branch's shared database.
- `payment.ts` captures explicit offline single-tender sales only after warehouse/shift/user checks. When negative stock is disallowed it requires a known snapshot for the exact branch/warehouse/product. Missing evidence fails closed.
- Capture persists the queued sale and then records stock movements in subsequent operations. There is no single cross-store business transaction covering the complete sale/stock/journal domain. Existing projection/replay guards address partial states; they do not establish a full local ERP transaction engine.
- `syncEngine.ts` replays only for the originating authenticated user, retains legacy ownerless or warehouse-unpinned rows as failures, supplies a stable operation key, requires success plus durable sale ID, reconciles an uncertain reply, then cleans scoped movements before dequeuing. Keep these guards in any replacement.
- `orders_queue`, `outbox_operations` and `auth_cache` are created by the schema; a source search did not find a general order replay worker using those stores. Store existence alone is not a working inbox/outbox.
- `AuthRepository` persists a profile/role matrix; it does not verify credentials offline or issue signed local permissions. Multi-day offline revocation/expiry and ownership contracts are open.
- `public/sw.js` pre-caches only the shell list, caches visited assets on demand, and excludes Supabase API/Auth/Realtime. It does not preinstall every lazy screen. `index.html` loads Google Fonts; product images may point to Storage. Cold offline completeness is unproven.

### Branch Hub and print execution

- `branch-hub/server.cjs` has `hub_identity`, print jobs, receipt drafts and pending sync events. It binds one synthetic organization/branch and refuses later identity changes in that data directory. Auth is one shared token; LAN requires supplied TLS files.
- SQLite receipt and outbox inserts share `BEGIN IMMEDIATE` and idempotency conflict checks. They are drafts, not stock/payment/journal postings.
- `desktop.cjs` displays hard-coded status HTML and forks the server. Window/app exit kills its child; there is no Windows Service definition in the installer package.
- `electron-builder.json` packages only `desktop.cjs`, `server.cjs` and `package.json`, with per-user NSIS configuration. It does not package the Premier `dist` bundle or a complete local domain server.
- The frontend's `localPrintAgent.ts` uses loopback port **17654**, with `/printers`, `/config`, `/print` and `/drawer`. Branch Hub defaults to **3847**, with different queue endpoints. There is no automatic interoperability contract between them. On a tablet, `127.0.0.1` denotes that tablet, so this URL is not a branch-host LAN endpoint.
- Cloud print is separate: enqueue/claim/start/complete RPCs and `cloud_print_jobs`, followed by an active browser agent's local execution. Enqueue success is not proof that paper was printed. Preserve uncertain-output, approval/reprint and routing semantics in WBS-30/31.

## Gap register and downstream tasks

| ID | Evidence / gap | Required later scope / gate |
|---|---|---|
| G01 | Installer/HTTP handler does not serve real Premier UI; authenticated browser root is 404 | WBS-20; Gate B |
| G02 | Electron close kills child; no persistent Windows Service | WBS-11; Gate B |
| G03 | Shared token and manually provided TLS/config; no signed enrollment or per-device lifecycle | WBS-10/12; Gate B |
| G04 | Local drafts and browser queue do not execute complete atomic business domains | WBS-01/02/21; Gate A then C |
| G05 | Cloud Realtime and per-browser stores do not coordinate multiple LAN cashiers/kitchen | WBS-22; Gate C |
| G06 | Frontend local-print protocol/port differs from hub; no hub physical print executor | WBS-30/31; Gate C |
| G07 | Hub explicitly reports cloud sync not implemented; no acknowledged bidirectional catalog/business sync | WBS-40/41/42; Gate D |
| G08 | No proved local journal/BOM/cost/stock reconciliation after duplicate, delayed or crash-interrupted replay | WBS-43; Gate D |
| G09 | No signed versioned update/migration/rollback channel preserving pending work | WBS-50; Gate E |
| G10 | Snapshot primitive tested; scheduled encryption, retention, off-machine recovery and disaster drill absent | WBS-51; Gate E |
| G11 | Shell/visited-asset cache and remote assets do not prove cold offline availability of all screens | WBS-20/50; Gate B/E |
| G12 | Clean install failed with npm 11; npm 10 retry interrupted; full app checks unavailable | Reproducible toolchain/lockfile evidence before accepting frontend verification; no lock repair done in WBS-00 |
| G13 | Generated API contract is stale for `inventory_unit_productions`, `v_current_sale_prices`, `v_current_stock_position` | Separately scoped regeneration/review of source API contract; not a hosted schema migration |

The old current-work-plan checkpoints include historical FIFO review work. This source baseline also contains later inventory views and retirement/reconciliation evidence. WBS-01 must explicitly reconcile the approved current stock/costing policy; this audit neither restores retired FIFO behavior nor authorizes removal of existing guards or historical repair.

## Verification evidence and limitations

| Check | Result | Evidence / boundary |
|---|---|---|
| Management project read | PASS | Exact ID/ref `hvqlkapynjfjikqithvd`, `ACTIVE_HEALTHY`; metadata only |
| `node scripts/db/verify-database-identity.js` | PASS | Canonical repository/project verified |
| `node scripts/db/verify-project-references.js` | PASS after report changes | Text references locked to canonical identities |
| `node --test branch-hub/server.test.cjs` | PASS: 8/8 | [hub-tests.log](windows-branch-server-audit-20261029/hub-tests.log): auth/dedupe, TLS gate, identity mismatch, durable drafts/outbox, concurrent retry, integrity, conflicting print key, backup/restore |
| Local browser with every non-loopback request aborted | OBSERVED GAP | [wan-probe.json](windows-branch-server-audit-20261029/wan-probe.json): authenticated `/#/pos` root 404; health 200; sync says false; candidate business/print endpoints absent |
| `node scripts/db/gen-contract.js --check` | FAIL at audited baseline | Stale contract; three newly referenced relations/views listed above. No regeneration performed |
| `npm ci --ignore-scripts --no-audit --no-fund` | FAIL with Node 24.21.0 / npm 11.19.0 | EUSAGE; missing optional platform entries including lightningcss, rolldown and rollup |
| npm 10.9.4 compatibility retry | INCOMPLETE | Produced peer-dependency warnings; interrupted before successful exit. No install success claimed |
| `npm run typecheck` | BLOCKED | `tsc` command unavailable after incomplete dependency installation; no TypeScript success claimed |
| App lint/build/unit/integration/E2E | NOT RUN | Clean install prerequisite unresolved. No frontend release gate claimed |
| Physical WAN unplug, full local authenticated business flow, two-device/branch operation, printer hardware, power crash | NOT TESTED | Browser fault injection and foundation tests are narrower than these acceptance scenarios |

The browser probe retains loopback networking and aborts all other browser requests; its canonical-host canary failed as injected. No canary request reached Supabase and no production mutation was made. It establishes the first broken browser→local-API boundary; it does not verify transaction durability or sync under physical network loss. Candidate endpoint 404s are corroboration; no future API naming is prescribed by the probe.

## Reproduction, impact and rollback

Audit tooling is stored in [the evidence directory](windows-branch-server-audit-20261029/README.md). Run against the audited commit in an isolated checkout. The generator reads source/migrations and writes inventory artifacts only; the browser probe creates synthetic SQLite state in the chosen output directory. It must not be pointed at a live Branch Hub directory.

Changed scope is this report, dependency appendix, audit evidence/tooling and a WBS-00 status note. No frontend/backend runtime, package manifest, lockfile, migration, CI workflow, RLS or database object is changed. Product behavior is unchanged. Reverting the documentation/audit PR removes the deliverables; it requires no database rollback or data migration. Synthetic local test directories may be removed after all test processes close; production pending queues must never be substituted or deleted.

## Acceptance disposition

**WBS-00: BLOCKED for acceptance**, with source inventory and isolated foundation/WAN evidence available for review. Remaining work: establish a successful clean frontend toolchain, resolve/review the stale generated contract in its own approved scope, run the existing Premier frontend in an isolated lab under injected WAN loss without production writes and record its observed failures by route family, and obtain owner sign-off. The missing Branch Hub frontend is a discovery finding for WBS-20, not a requirement to implement WBS-20 before completing discovery. Do not interpret this discovery PR as permission to implement WBS-01/02 or to select SQLite/PostgreSQL by assumption. Gate A and all implementation phases remain open.
