# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/DATA_COPY_PREP_2026-09-28.md`
- Current writable repository: `Premieros/.com`
- Current writable branch: `development/data-copy-prep-20260928`
- Current Supabase project: `hvqlkapynjfjikqithvd`
- Original reference repository `Premieros/johna-s`: READ ONLY.
- Original Production Supabase `azzdesuowpdcoflmyezn`: READ ONLY / SOURCE ONLY.
- السجل هو المرجع الإجباري للعمل؛ الذاكرة والمحادثة ليستا Source of Truth.
- لا تعديل مباشر على `main` في مسار تجهيز نسخ البيانات.
- قبل كل write: تحقق من أحدث branch HEAD. أي HEAD غير متوقع = STOP_AND_RECONCILE.

## FIXED IDENTITY FENCE

- Repository الوحيد المسموح بالكتابة عليه: `Premieros/.com`
- Supabase الوجهة الوحيدة: `hvqlkapynjfjikqithvd`
- مصدر البيانات فقط: `azzdesuowpdcoflmyezn`
- ممنوع أي write / migration / destructive SQL على المصدر.
- Preserve Permission-First, RLS, organization isolation, branch isolation, and Super Admin implicit bypass only.

## ACTIVE — DATA COPY PREPARATION

Goal:
Prepare a safe data-only migration from `azzdesuowpdcoflmyezn` to `hvqlkapynjfjikqithvd` while preserving the organization-aware `.com` schema.

### Current verified source
- 134 public tables.
- 2 operational branches (Cleopatra, Smoha).
- 33 public users / 34 auth users.
- 508 products.
- 803 raw materials.
- 1213 orders.
- 1151 sales.
- 171 purchases.

### Current verified destination
- 131 public tables.
- 1 bootstrap organization / branch.
- 2 public users / 2 auth users.
- Operational products/raw materials/orders/sales/purchases are still empty.

### Known schema drift blocking blind copy
Source-only tables:
- `raw_fifo_debt_price_estimates`
- `raw_fifo_price_fallback_plan`
- `raw_fifo_price_fallback_runs`
- `supplier_opening_balances`

Destination-only table:
- `organization_feature_overrides`

### Data-copy rules
- Do not dump/restore source schema over destination.
- Do not overwrite destination organization/module infrastructure.
- Preserve operational UUIDs where safe, especially branch and transaction identifiers.
- Build explicit organization/branch/user mapping before import.
- Auth migration must preserve UUID relationships; existing source sessions are not assumed valid in destination.
- Classify every table before copy: COPY / COPY_WITH_MAPPING / REBUILD_DERIVED / KEEP_DESTINATION / SKIP_RUNTIME.
- Run FK, row-count, financial, inventory, RLS, tenant isolation, and application verification before cutover.
- No production copy until preparation is complete and explicitly approved.

## VERIFICATION GATE BEFORE ANY DATA COPY

Required:
- exact schema compatibility matrix
- explicit import order
- source/destination organization mapping
- auth/public.users mapping
- branch UUID collision check
- FK dependency validation
- destination baseline snapshot/counts
- rollback/cleanup plan for failed import
- Full Verify Green on preparation branch if repository code/scripts are changed

## NEXT ACTION

1. Complete table compatibility classification.
2. Port only the missing schema elements needed by source data, without removing `.com` organization additions.
3. Prepare data import order and validation SQL.
4. Stop before executing the production copy and request explicit approval.
