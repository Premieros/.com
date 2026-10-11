# Premier Architecture V2 — Accounting Phase 5I
## Organization Account Shadow Identities / Explicit Branch Links

### Design and boundaries
This phase adds a **private organization-owned account identity**, but does not switch the operational chart of accounts or journal posting sources. The authoritative writer remains `public.chart_of_accounts` and existing `account_mappings` and `journal_entry_lines.account_id` continue referencing the original branch UUIDs. Existing accounting periods, journal immutability, FIFO, sale snapshots and purchase flows are unchanged.

The canonicalization here is deliberately **shadow-only**. Calling it a completed org-level CoA accounting migration would be inaccurate; changing journal posting to org accounts requires a later separately gated design.

### Production starting state (read-only assessment)
- Phase 5H diagnostic views are live and private.
- 3 organizations, 5 branches; 183 branch-scoped account records grouped into 126 organization-and-code identities.
- 40 identities have partial branch coverage. This is a meaningful property of branch-level account availability, **not a reason to invent missing branch accounts**.
- 0 inconsistent account name/type/flag definitions; 0 wrong-branch account mappings and 0 orphan journal account references.
- At least 2,247 posted journal headers; absolutely do not rewrite their UUID references.

### Migration
`private.organization_accounts_v2` has one unique identity per `(organization_id, code)`, its account type/name/status and initial source coverage frozen at bootstrap.

`private.organization_account_branch_links_v2` records an explicit mapping from **each existing branch account UUID** to the organization identity. It preserves branch and organization context and FK integrity. The bootstrap is atomic and refuses to proceed if Phase 5H reports blocking conflicts, missing organization scoping, missing mappings or cross-organization links. It does not infer new branch accounts.

`private.organization_account_link_health_v2` compares the shadow link against each *current* legacy branch account, flags absent mappings and account code/type/name/flag drift. `private.organization_account_mapping_summary_v2` summarizes drift by organization.

The new tables have RLS enabled and all API role direct privileges revoked. The private views are not browser-readable. No public RPC, exposed page or privileged mutation command is created.

### Lifecycle and follow-on
This is a one-time bootstrap snapshot. New accounts/branches, renames and type changes are **not auto-updated** in the org shadow model; health flags reveal those changes immediately. A later reviewed promotion/synchronization command with organization approvals, period permissions and immutable audit trails must handle them explicitly. No historical backfill of journal lines.

### Acceptance
- All existing 44+ Architecture V2 integration regression tests and Playwright pass.
- Direct API roles cannot read, insert or modify private identities/links.
- Source branch-account count equals link count exactly at bootstrap; all mappings have matching organization/code/type and no orphaned journal reference.
- Within a transactional CI fixture, a new organization/account remains deliberately unmapped and appears in health diagnostics.
- After migration deploy, independently compare full live mapping counts and confirm no journal lines, account mapping references or periods changed.
- Only close this phase after CI, migration, production-readiness evidence and main PR merge are verified.
