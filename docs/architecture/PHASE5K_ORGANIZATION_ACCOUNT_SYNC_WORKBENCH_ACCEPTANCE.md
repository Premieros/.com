# Premier Architecture V2 — Accounting Phase 5K Acceptance

## Purpose
Provide an administrative **organization account sync review workbench**, embedded in the existing Chart of Accounts page (`/accounts`), without exposing private accounting tables to the browser. This is a *shadow model governance* UI, not promotion of organization chart identities to journal posting.

### Surface
- Existing `accounts.manage` users see a "Organization Sync Review" toggle on the `/accounts` page. The route remains gated by the existing `accounts.view` authorization and business-module rules.
- A live server-generated candidate list displays each branch account with nonmatching or missing shadow mapping. It shows the source branch definition, shadow master definition (when present), and the server plan. Accounts whose plans require manual review do not offer a submit action.
- The request queue and bounded history (up to 100 each per selected organization) show requester/reviewer, creation/expiry timestamps, operation, request reason, state and review note.
- Clicking a request displays a side-by-side, **frozen proposed / current branch / shadow master** comparison, warning about stale/expired records.
- Submitting a reasoned request calls Phase 5J `request_organization_account_sync_v2`; approving or rejecting with a reviewer note calls `decide_organization_account_sync_v2`.
- The UI hides approval controls on the requester's own pending requests. It disables approval on stale data, asks for explicit confirmation, disables actions while saving, and refreshes after each successful action. **Database RPCs enforce these checks independently.**
- Arabic and English translations are present within this initial scoped UI; it uses the existing DesignPanel/Button and app toast/design tokens.

### Backend read API
`public.get_organization_account_sync_workbench_v2(p_organization_id uuid default null, p_limit integer default 100)` is a stable SECURITY DEFINER projection:
- Requires `auth.uid()`, an active `public.users` profile and `accounts.manage`.
- Returns only organizations for which `public.user_may_access_branch` is true **for every branch**.
- Rejects an explicit organization filter outside this scope.
- Includes only bounded candidate and request/history rows for those organizations, with a re-evaluated live readiness plan and stale indicator; never consumes, approves, expires or edits requests on reads.
- Executable by `authenticated` only; no `anon`, `service_role` or public execution. All underlying private tables retain RLS and their existing revoked direct access.
- Financial ledger/account posting code and all old journal UUID references remain unchanged.

### Acceptance gates
1. CI verify/lint/typecheck/build/unit, all DB migrations and integration/RLS tests, Playwright browser smoke.
2. DB integration fixtures must verify unauthenticated/underprivileged caller denials, cross-org visibility and explicit org-filter denial, frozen request versus current drift, no database writes from the read method.
3. Production migration uses the exact same version timestamp on `main` as Supabase recorded. Post-deploy check: 126 organization identities; 183/183 branch links; 0 drift; 7,259 journal lines and 2,247 posted journals untouched; no new request rows created by deployment.
4. No real accounting synchronization request should be approved automatically and no live user decisions should be made for acceptance. Any Production smoke must use rollback-only fixtures.
5. Merge only after final-head GitHub Actions verify/db/browser and Vercel are all green.

### Explicitly deferred
Bulk auto-sync, changing existing organization account code/type/system status, exposing a privileged private table REST API, and switching journal posting to organization account identifiers. These each require separate risk review and are not part of Phase 5K.
