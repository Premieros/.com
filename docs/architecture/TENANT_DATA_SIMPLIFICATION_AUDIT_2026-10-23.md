# Tenant data model simplification — initial read-only audit (2026-10-23)

Scope: `Premieros/.com`, Supabase project `hvqlkapynjfjikqithvd`. **Read only** database inspection. No data was deleted, migrated or edited.

## Why
User reports tenant deletion complexity and suspects excess event rows, duplicated representations, and over-coupled relationships. Deletion is a symptom rather than the main optimization target. Preserve financial auditability and tenant isolation.

## Observed facts
- 141 public tables, all flagged RLS enabled by table summary; private schema also has tables.
- Public+private FK constraint query returned 435 relationships, 218 CASCADE (scope-specific counts; do not mix with earlier 464 global count).
- Main data/total-size contributors as of audit (PostgreSQL pg_total_relation_size includes indexes; pg_stat rows estimates):
  - public.raw_fifo_backfill_batch_plan 46,881 / 8,126,464 bytes
  - public.inventory_ledger 21,756 / 7,561,216 bytes
  - public.order_kitchen_inventory_effects 13,923 / 4,300,800 bytes
  - public.sale_item_inventory_effects 12,338 / 4,104,192 bytes
  - public.raw_fifo_debts 8,718 / 3,235,840 bytes
  - public.order_kitchen_inventory_events 5,354 / 3,112,960 bytes
  - public.raw_material_batches 11,055 / 2,809,856 bytes
  - public.journal_entry_lines 7,259 / 2,121,728 bytes
  - private.organization_journal_line_evidence_v2 7,259 / 1,589,248 bytes
- products has `trg_sync_product_canonical_item` calling `sync_product_canonical_item`: canonical item migration coexistence must be traced before deprecating products/raw_materials.
- orders has seven direct non-internal triggers; order_items six. Inspect nested RPC/trigger paths for redundant writes, locking, and transaction boundaries.
- Org `الفرع الرئيسي`: 3 branches, 31 non-super-admin users, 26,762 operational_documents per full preflight; eligible=true, blockers=[] in `private.organization_full_deletion_preflight`. Two prior organization_deletion_jobs failed `DELETE_BLOCKED_ATOMICALLY` on 2026-10-22. Do not conflate preflight success with deletion success.
- Supabase advisors: 153 unindexed FK warnings, 19 auth RLS initplan, 73 multiple permissive policies, 279 authenticated SECURITY DEFINER warnings. Warnings require review, not blanket modifications.
- Known unresolved historical raw FIFO differences: GitHub issue #100; offline warehouse availability integrity: #103.

## Audit work packages, in priority order
1. **Actual sale write graph**: identify UI -> RPC -> functions -> nested triggers -> written tables for standard sale, kitchen send/void, return, modifier, offline replay. Capture writes per transaction with CI-only rollback fixtures, and distinguish source of truth / append-only ledger / required snapshot / derived cache / temporary backfill artifact. Never simulate with production financial writes.
2. **Entity/tenant graph**: map organization -> branches/warehouses -> items/item_sites/products/raw materials -> recipes -> batches -> accounting. Trace ownership of each table, global/shared references, cross-tenant invariants, delete semantics, and sources of duplicated data.
3. **Historical & derived data**: inventory_ledger vs effects vs raw FIFO tables and backfill plan. Verify consumer references, constraints, archival/rebuildability and business requirements *before* marking anything removable.
4. **Performance**: record representative EXPLAIN plans, index use, event counts per sale/line, trigger duration and transaction contention using safe samples; prioritize indexes only for measured bottlenecks.
5. **Design proposal**: documented single ownership model, canonical item transition, limited projection/cache layers, explicit outbox where needed, immutable posted journals, retention/archive policy, versioned migrations and rollback steps.
6. **Acceptance tests**: multi-tenant isolation, no cross-org deletes or accidental sharing, POS/stock/FIFO/COGS/journal invariants, offline warehouse behavior (issue #103), historical exception gating (issue #100), compare before/after write counts and latency.

## Guardrails
- Do not delete accounting/stock history or truncate backfill tables solely based on row count.
- Do not bypass RLS, FK or work authorization to make tenant deletion succeed.
- No production DDL or business data mutations from this audit.
- Any schema change: separate reviewed migration, backup/recovery strategy, isolated staging validation, and approval.
- Report evidence and uncertainty explicitly; observed cardinality alone is not proof of duplication.

## First decision gates
- Confirm whether raw_fifo_backfill_batch_plan is still consumed at runtime or only as migration/audit provenance.
- Determine whether products -> items canonical synchronization is one-way and if reverse reads remain.
- Reconstruct write graph for a single representative sale, with count of effects per sale item, before any refactor.
