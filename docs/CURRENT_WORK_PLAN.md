# CURRENT WORK PLAN — Premieros/.com — SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/ORGANIZATION_MODULES_2026-09-27.md`
- Current writable repository: `Premieros/.com`
- Current writable branch: `main`
- Current Supabase project: `hvqlkapynjfjikqithvd`
- Original reference repository `Premieros/johna-s`: READ ONLY.
- Original Production Supabase `azzdesuowpdcoflmyezn`: BLOCKED.
- السجل هو المرجع الإجباري للعمل؛ الذاكرة والمحادثة ليستا Source of Truth.
- CI يجب أن يفشل إذا اختلف Repository أو Supabase Project عن الهوية المثبتة هنا.
- لا Merge ولا Production migration إلى أي بيئة أخرى؛ hosted migration على المشروع الجديد فقط وبعد Full Verify Green.
- المستخدم صرّح صراحة أن هذا المشروع Development فقط ولا يوجد عليه تشغيل فعلي، ولذلك الكتابة المباشرة على `main` مسموحة لهذا المسار.
- قبل كل write: تحقق من أحدث `main` HEAD. أي HEAD غير متوقع = STOP_AND_RECONCILE.

## FIXED IDENTITY FENCE

- Repository الوحيد المسموح بالكتابة عليه: `Premieros/.com`
- Supabase الوحيد المسموح استخدامه بعد التحقق: `hvqlkapynjfjikqithvd`
- GitHub Pages source: `Premieros/.com@main`
- ممنوع تمامًا أي write / merge / migration / deploy إلى:
  - `Premieros/johna-s`
  - `azzdesuowpdcoflmyezn`
  - أي Repository أو Supabase ref آخر.
- `scripts/db/verify-database-identity.js` يجب أن يفشل فورًا إذا كانت هوية GitHub أو Supabase مختلفة.

## ACTIVE — Organization Modules

الهدف الحالي:
تقسيم النظام إلى موديولات يمكن تفعيلها أو تعطيلها لكل مؤسسة بشكل مستقل، مع استمرار الصلاحيات داخل كل موديول بنظام Permission-First.

### Architectural contract

`Organization access = active organization + enabled module + branch scope + user permission`

Super Admin فقط هو platform-wide implicit bypass.

### Initial module families

- Core / Dashboard
- POS
- Catalog
- Inventory
- Procurement
- Customers
- Suppliers
- Expenses
- Shifts
- Treasury
- Accounting
- Costing
- Reports
- Users & Permissions
- Approvals
- Import / Export
- Branch Management
- Audit
- KDS as an independently switchable module without changing its internal runtime in this scope.

### Rules

- Reuse existing `features`, subscriptions and feature-resolution infrastructure.
- Do not build a duplicate feature system.
- Organization override is authoritative over plan defaults when explicitly set by Super Admin.
- UI hiding alone is not security; route/API/database enforcement must agree.
- Permission-First remains mandatory after module access is granted.
- Disabling a module must not delete its historical data.
- Re-enabling a module restores access to historical data subject to normal permissions.
- No module toggle may weaken RLS or branch/tenant isolation.
- No printing / Print Agent / routing / send-to-kitchen implementation changes in this project phase.

## DATABASE CHANGE GATE

- Schema/RPC migration files can be developed on `main`.
- Hosted Supabase apply is BLOCKED until Full Verify Green.
- No experimental migration on hosted Supabase.
- No destructive reset/reseed.
- Migrations are forward-only and append-only.

## VERIFICATION

Required before hosted migration:
- repository identity lock ✅
- lint
- typecheck
- unit
- build
- fresh DB migrations
- schema verification
- integration + RLS/security
- Browser Smoke
- organization A cannot see organization B modules/data
- disabled module denied even when user has permission
- enabled module still requires permission
- Super Admin can configure organizations without cross-tenant data leakage

## NEXT ACTION

1. Normalize the module catalog from the existing feature registry.
2. Add organization-level feature/module overrides.
3. Replace unrestricted runtime resolver with an authoritative resolver.
4. Add frontend module context/cache.
5. Filter menu and protect routes by module + permission.
6. Add Super Admin organization module control UI.
7. Add regression tests and run Full Verify.
8. Apply hosted migration only after Green.
