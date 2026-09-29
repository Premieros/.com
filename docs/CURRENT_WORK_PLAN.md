# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/DATA_COPY_PREP_2026-09-28.md`
- Current writable repository: `Premieros/.com`
- Current writable branch: `development/data-copy-prep-20260928`
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

## ACTIVE — DATA COPY FINALIZATION

Goal:
Complete and verify the data-only migration from `azzdesuowpdcoflmyezn` to `hvqlkapynjfjikqithvd` while preserving the organization-aware `.com` schema and enforcing the approved cutoff at the end of 2026-09-28 Africa/Cairo.

### Current status

- Data copy through cutoff: COMPLETE.
- Final database validation: COMPLETE.
- Source remained READ ONLY.
- No checked post-cutoff operational rows remain in destination.
- Financial aggregates through cutoff match source.
- RLS remains enabled.
- No USER triggers remain disabled.
- User approved merge.
- PR #7 remains blocked only until CI is Green.

### Data-copy rules

- Do not dump/restore source schema over destination.
- Do not overwrite destination organization/module infrastructure.
- Preserve operational UUIDs where safe.
- Preserve the destination login/bootstrap identity mapping.
- Map protected destination table IDs when source/destination UUIDs intentionally differ.
- Exclude post-cutoff activity even when its UTC date is 2026-09-28.
- Do not replace current cutoff state with later live-source FIFO/batch mutations.

## VERIFICATION GATE BEFORE MERGE

Required:
- mandatory active work log structurally complete
- locked Supabase project identity correct
- frontend API contract current
- lint Green
- typecheck Green
- unit tests Green
- build Green
- DB verification Green
- browser smoke Green where configured
- PR head branch matches declared active branch
- PR mergeable with no unexpected HEAD movement

## NEXT ACTION

1. Make PR #7 Ready for Review.
2. Run CI on the corrected documentation HEAD.
3. Merge only when required checks are Green.
4. Verify merged state and merge commit on `main`.
