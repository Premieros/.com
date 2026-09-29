# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/ORGANIZATION_EXPERIENCE_NO_CODE_CONTROL_2026-09-29.md`
- Current writable repository: `Premieros/.com`
- Current writable branch: `development/organization-theme-pos-layout-20260929`
- Current Supabase project: `hvqlkapynjfjikqithvd`
- Original reference repository `Premieros/johna-s`: READ ONLY.
- Original Production Supabase `azzdesuowpdcoflmyezn`: READ ONLY / SOURCE ONLY.
- السجل هو المرجع الإجباري للعمل؛ الذاكرة والمحادثة ليستا Source of Truth.
- لا تعديل مباشر على `main`.
- قبل كل write: تحقق من أحدث branch HEAD. أي HEAD غير متوقع = STOP_AND_RECONCILE.
- CI يجب أن يفشل إذا كان السجل الإجباري ناقصًا أو لا يطابق الفرع النشط.
- لا Merge ولا Production migration/data write قبل Green CI والتحقق النهائي والموافقة الصريحة.

## FIXED IDENTITY FENCE

- Repository الوحيد المسموح بالكتابة عليه: `Premieros/.com`
- Supabase الوجهة الوحيدة: `hvqlkapynjfjikqithvd`
- مصدر البيانات فقط: `azzdesuowpdcoflmyezn`
- ممنوع أي write / migration / destructive SQL على المصدر.
- Preserve Permission-First, RLS, organization isolation, branch isolation, and Super Admin implicit bypass only.

## ACTIVE — ORGANIZATION EXPERIENCE / SUPER ADMIN NO-CODE CONTROL

Goal:
Make broad organization customization manageable from Super Admin without source-code edits, while keeping one shared codebase and protecting the financial/security core.

### Active scope
- organization-specific theme profile
- organization terminology pack
- organization-specific POS layout preset
- activity-aware POS visibility and labels
- customization of existing organizations from Super Admin
- safe fallback for organizations that do not yet have explicit overrides
- configuration-driven navigation terminology

### Non-negotiable safety boundary
Never expose these as arbitrary no-code customization:
- RLS/security policies
- settlement/payment invariants
- accounting posting logic
- inventory integrity/consumption rules
- permission identifiers/authorization semantics
- Print Agent routing safety
- arbitrary SQL/scripts

### Status
- active implementation on `development/organization-theme-pos-layout-20260929`
- base `main`: `b647830ad93ef1028db3c62818cf3dcc7585ecf3`
- no Production migration/data write in this phase
- source repository and source Supabase remain READ ONLY
- authoritative progress and checklist live in `docs/ORGANIZATION_EXPERIENCE_NO_CODE_CONTROL_2026-09-29.md`

## VERIFICATION GATE BEFORE MERGE

Required:
- mandatory active work log structurally complete
- locked Supabase project identity correct
- frontend API contract current if affected
- lint Green
- typecheck Green
- unit tests Green
- build Green
- DB integration/security Green
- browser smoke Green
- restaurant default behavior preserved
- non-restaurant layout visibility verified
- PR head matches declared branch

## NEXT ACTION

1. Inspect current branch for TypeScript/runtime regressions.
2. Complete safe Super Admin customization controls and POS behavior.
3. Add contract/browser regression tests.
4. Open Draft PR.
5. Run Fast Verify and Full Verify on exact final HEAD.
6. Stop before merge/deployment unless explicit approval is given.
