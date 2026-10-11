# Premier Architecture V2 — Accounting Phase 5H: Organization CoA Readiness

## Scope and sequence
Phase 5A–5G are already present on `main`. Phase 5H is an **additive private read/diagnostics gate**, not a switch to an organization-owned chart of accounts and not an accounting writer rewrite.

The eventual target is a single organization-level chart of accounts, with branch/cost-center dimensions and controlled migrations of existing branch-level references. Those migrations must not begin until existing account-code conflicts and branch coverage are observable.

## Production reconnaissance (2026-10-11, read-only)
- 3 organizations, 5 branches.
- 183 legacy `public.chart_of_accounts` rows, all attached to branches with organizations.
- 29 (organization, code) keys are repeated across branches.
- No conflicting account types, names, `is_system` flags, or `is_active` flags in sampled live aggregates.
- 2,247 already-posted journals: never relabel, backfill, or change their account IDs.

## New private projections
`private.organization_chart_of_accounts_v2` groups existing branch account rows by organization ID and **exact legacy account code**; preserves all branch-account UUID links and flags:

- `CONSISTENT` — same account type, name, flags across all branches of the organization.
- `PARTIAL_BRANCH_COVERAGE` — a branch lacks the legacy code; not necessarily a defect.
- `CONFLICT_ACCOUNT_TYPE`, `CONFLICT_NAME`, `CONFLICT_TRANSLATION`, `CONFLICT_SYSTEM_FLAG`, `CONFLICT_ACTIVE_STATUS` — inconsistent definitions that block promotion to canonical.
- `DUPLICATE_BRANCH_CODE`, `MISSING_ORGANIZATION` — invalid identity/scope cases.

`private.organization_chart_account_conflicts_v2` exposes only blocking statuses.

`private.organization_chart_account_readiness_v2` aggregates complete/partial/conflict counts per organization.

These are diagnostic views **only**. They are internal to the `private` schema, with direct SELECT revoked from anon/authenticated/service_role. No public RPC, no browser access and no SECURITY DEFINER function is added.

## Non-breaking guarantees
- `public.chart_of_accounts` and `public.account_mappings` remain the operational writers and references.
- No update/delete/rekeying of posted `journal_entries` or `journal_entry_lines`.
- No modifications to FIFO, settlement, refunds, sale checkout, purchase posting or period locks.
- No historical backfill or inferred canonical account UUID.
- Existing organization and branch isolation stays in place.

## CI acceptance
- Verify schemas and private privileges.
- In a rollback-only CI transaction create a synthetic organization, two branches, a shared account code and a deliberately conflicting account type. Assert correct consolidation, UUID link retention and classification.
- Preserve legacy source count equality.
- Verify the prior 44-test Architecture V2 baseline alongside the new tests and Playwright before merging.

## Next step
Phase 5I can introduce a canonical organization-owned account entity and explicit (organization, code) to branch-account identity mappings **only after** a reviewed conversion plan. Do not replace journal account IDs in place. Later stages add cost-center accounting dimensions and AP/AR allocations under the same permission, period and append-only controls.
