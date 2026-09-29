# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/SYNC_JOHNA_STABILITY_COSTING_2026-09-29.md`
- Current writable repository: `Premieros/.com`
- Current writable branch: `development/sync-johna-stability-costing-20260929`
- Current Supabase project: `hvqlkapynjfjikqithvd`
- Original reference repository `Premieros/johna-s`: READ ONLY.
- Original Production Supabase `azzdesuowpdcoflmyezn`: READ ONLY / SOURCE ONLY.
- السجل هو المرجع الإجباري للعمل؛ الذاكرة والمحادثة ليستا Source of Truth.
- لا تعديل مباشر على `main` في هذا المسار.
- قبل كل write: تحقق من أحدث branch HEAD. أي HEAD غير متوقع = STOP_AND_RECONCILE.
- CI يجب أن يفشل إذا كان السجل الإجباري ناقصًا أو لا يطابق الفرع النشط.
- لا Merge ولا Production migration قبل Green CI والتحقق النهائي والموافقة الصريحة.

## FIXED IDENTITY FENCE

- Repository الوحيد المسموح بالكتابة عليه: `Premieros/.com`
- Supabase الوجهة الوحيدة: `hvqlkapynjfjikqithvd`
- مصدر البيانات فقط: `azzdesuowpdcoflmyezn`
- ممنوع أي write / migration / destructive SQL على المصدر.
- Preserve Permission-First, RLS, organization isolation, branch isolation, and Super Admin implicit bypass only.

## ACTIVE — JOHNA STABILITY + COSTING SYNC

Goal:
Port only already-merged and validated stability/costing changes from `Premieros/johna-s` into `Premieros/.com` without writing to the source project and without weakening the organization-aware target model.

### Scope
- source PR #401: bounded dashboard snapshot, system health, report-loader containment, internal trigger EXECUTE hardening
- source PR #403: decimal numeric drafting and linked manufactured-group costing
- source PR #404: theoretical costing from current recipe/raw-material source
- source PR #402: explicitly excluded while Draft

### Status
- implementation committed on PR #8 branch
- source repository and source Supabase remain READ ONLY
- CI verification pending
- Production migration not applied

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

1. Run PR #8 CI.
2. Repair only target-side regressions.
3. Do not merge or migrate Production until Green verification and explicit approval.
