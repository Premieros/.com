# Premier Architecture V2 — Accounting Phase 5J Controlled Shadow CoA Synchronization

## Context and operational boundary
Phase 5I introduced 126 private organization account identities with explicit links to 183 existing branch account UUIDs. These remain a **shadow master** only; `public.chart_of_accounts`, `public.account_mappings` and existing `journal_entry_lines.account_id` stay authoritative for posting. Phase 5J addresses **later** branch account creation and approved label synchronization, not historical journal migration.

## Two-person workflow
- A logged-in, active requester with `accounts.manage` and full branch access across the target organization proposes one exact branch-account snapshot (reason at least 3 characters).
- A **different** logged-in, active reviewer with **both** `accounts.manage` and `approvals.review` and full organization branch access approves or rejects. `approvals.override` does **not** override this separation.
- Each request expires after 24 hours; duplicate pending proposals per branch account are refused; a decided request cannot be consumed twice.
- At approval time the system re-reads and locks the actual branch account, recalculates the full proposed snapshot and rejects stale/changed state. A per-org-code advisory transaction lock serializes competing shadow promotions.
- `LINK_NEW` links an unmapped branch account to an existing **matching** org identity, or creates a new shadow identity when no one exists. It never invents missing branch accounts.
- `REFRESH_LABELS` updates only shadow account name, English name and active state; every existing linked branch account must already agree on those values. It does **not** change account code, type or system-account flag.
- Cross-org, missing organization, wrong sibling attributes, divergent account types and code changes require manual review and are not silently applied.
- Requests and decisions are recorded in a **private RLS-enabled request table** with durable requester/reviewer identities, status, source JSON snapshot, and reason. Application roles have no direct table permissions; API calls must go through the permission-checking public functions.
- Both request and resolution write an ordinary append-only business audit event to `public.audit_log` within the same database transaction. `STALE`, `REJECTED`, `EXPIRED`, and `APPLIED` are explicit terminal states. The accounting ledger itself remains append-only and untouched.

## Strict safety controls
No change to original `chart_of_accounts`, `journal_entry_lines.account_id`, journal posting writers, period locks, FIFO, inventory or sale/purchase finance pathways. No automatic periodic job, background synchronization or browser permission on private tables. No update of already posted journals or their account IDs. Existing account hierarchy/FK relationships remain intact.

This is a focused Phase 5J accounting governance **backend**, not a rollout of an admin UI or generic accounting approval engine. Existing manager POS approval workflows are not modified.

## Acceptance
CI must validate:
- All Architecture V2 legacy integration/security tests continue to pass.
- Private table RLS/direct privilege denial and no `anon` RPC invocation.
- Synthetic users in rollback-only transactions: approved second-user link, self-approval rejection, duplicate pending/replay rejection, stale input denial, frozen source equality, label-only sync, no unexpected journal effects.
- Post-migration Production: identity/link counts unchanged at deploy, no pending requests and no mapping drift; approval API privilege checks enforced. Test transactional rollback without leaving fixtures.
- Merge only on green Verify + DB + Playwright, after migration filename aligns with Supabase actual history.

## Deferred by design
A separate later step can expose a reviewed UI, handle code/type/systems changes with specialized migration and business controls, and eventually promote organization accounts as operational posting identities; this phase does neither.
