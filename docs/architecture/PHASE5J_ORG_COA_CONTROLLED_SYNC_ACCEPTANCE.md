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

## Final Production readiness and acceptance — 2026-10-11

- Production migration registered as `20261011101007_phase5j_controlled_org_account_sync` on locked Supabase project `hvqlkapynjfjikqithvd`.
- The migration filename tracked on the PR has been reconciled to the exact applied history version.
- Pre/post deploy financial invariants: 126 organization account identities, 183 explicit branch-account links, 183 original accounts, 0 drift; 7,259 historical journal entry lines, 2,247 posted journals, 120 legacy semantic mappings and 4 fiscal periods unchanged.
- Immediately after rollout: **0 synchronization requests**, 0 automatic remappings or account promotions.
- Private request table has RLS enabled. No direct SELECT to `anon` or `authenticated`, no direct service-role UPDATE. `anon` cannot execute either public RPC; `authenticated` can invoke them only through the explicit in-function authorization gates. Private plan helper is not executable by `authenticated`.
- GitHub Actions `Verify main` run `38130703038`: `verify` PASS; `db` **58/58 PASS across 7 files**; `browser-smoke` PASS.
- Production rollback smoke: synthetic org/branch, account, two distinct active Super Admin users. Requester self-approval returned `SELF_APPROVAL_FORBIDDEN`; independent reviewer applied approval; shadow health became `MAPPED_OK`; exactly 2 audit events recorded. Deliberate exception rolled back all data and audit, with **0** residual synthetic orgs, branches, branch accounts or sync requests. This test used the actual Supabase `request.jwt.claim.sub` authentication source.
- Existing `approval_requests` manager/POS workflow has not been modified. No new auto-synchronization and no UI activation in this phase.

### Non-blocking next step
Governed user interface for reviewing the private queue and controlled expansion to structural account changes after separate review. Do not promote the shadow CoA into journal posting as part of Phase 5J.
