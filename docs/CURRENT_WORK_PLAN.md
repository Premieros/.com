# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/ORGANIZATION_BUSINESS_PROFILES_2026-09-29.md`
- Current writable repository: `Premieros/.com`
- Current writable branch: `development/organization-business-profiles-20260929`
- Current Supabase project: `hvqlkapynjfjikqithvd`
- Original reference repository `Premieros/johna-s`: READ ONLY.
- Original Production Supabase `azzdesuowpdcoflmyezn`: READ ONLY / SOURCE ONLY.
- السجل هو المرجع الإجباري للعمل؛ الذاكرة والمحادثة ليستا Source of Truth.
- لا تعديل مباشر على `main`.
- قبل كل write: تحقق من أحدث branch HEAD. أي HEAD غير متوقع = STOP_AND_RECONCILE.
- CI يجب أن يفشل إذا كان السجل الإجباري ناقصًا أو لا يطابق الفرع النشط.
- لا Merge ولا Production migration قبل Green CI والتحقق النهائي والموافقة الصريحة.

## FIXED IDENTITY FENCE

- Repository الوحيد المسموح بالكتابة عليه: `Premieros/.com`
- Supabase الوجهة الوحيدة: `hvqlkapynjfjikqithvd`
- مصدر البيانات فقط: `azzdesuowpdcoflmyezn`
- ممنوع أي write / migration / destructive SQL على المصدر.
- Preserve Permission-First, RLS, organization isolation, branch isolation, and Super Admin implicit bypass only.

## ACTIVE — ORGANIZATION BUSINESS PROFILES

Goal:
Create complete business-aware organizations from Super Admin using reusable presets while keeping one shared multi-tenant codebase.

### Scope
- business presets: restaurant, food manufacturing, pharmacy, car showroom, tourism, retail, services, custom
- atomic organization provisioning: organization, first branch, warehouse, settings, trial, owner, membership
- explicit organization module selection derived from the preset and editable before creation
- stored terminology and capability profile for later activity-specific UI behavior
- no change to printing, Print Agent, KDS internals, send_to_kitchen, or shifts

### Status
- implementation active on `development/organization-business-profiles-20260929`
- PR #9 migrations applied to hosted Production `hvqlkapynjfjikqithvd` after explicit approval
- full Production API contract parity is Green; source repository and source Supabase remain READ ONLY

## VERIFICATION GATE BEFORE MERGE

Required:
- mandatory active work log structurally complete
- locked Supabase project identity correct
- frontend API contract current
- lint Green
- typecheck Green
- unit tests Green
- build Green
- DB integration/security Green
- browser smoke Green
- PR head matches declared branch

## NEXT ACTION

1. Run Fast Verify and Full Verify on the documentation-only final HEAD.
2. If Green, mark PR #9 Ready for Review.
3. Stop before merge unless explicit merge approval is given.
