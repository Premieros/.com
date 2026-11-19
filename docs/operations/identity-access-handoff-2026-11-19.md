> **19 Nov 2026 scope correction:** The user confirmed super administrators are global and never bound to a branch. A single unnecessary direct grant for `developer` was removed in a guarded production transaction. Post-change verification: four `super_admin` profiles, zero non-null `branch_id` and zero direct `user_branch_access` grants. User roles, credentials and other branch permissions unchanged. The read-only release audit now checks both conditions. The 29 active unmatched Auth profiles, three unowned branches, and signup review remain unresolved.

# Premier OS — identity and permission acceptance (19 Nov 2026)

Project: `hvqlkapynjfjikqithvd`. This procedure is **read-only** until a real human has validated account ownership and approved provisioning. No credentials, emails, token values, or raw user IDs belong in public issue comments.

## Read-only production findings
- 41 application profiles, 11 Supabase Auth identities; 29 **active** profiles without a matching Auth UUID.
- Of these 29: one has an email matching an Auth identity with a **different UUID**; 28 have no matching Auth email. Matching email is **not** proof of identity, nor permission to change UUIDs.
- Unmatched active profiles by role: cashier 7, branch_manager 5, cap_cleopatra 5, cap 5, custom role 34567 2, accountant 1, owner 1, kitchen 1, another kitchen role 1, super_admin 1.
- 40 user/branch access links, 29 linked to profiles without corresponding Auth identities; no access links point to a nonexistent app profile or branch.
- Six active organization memberships: all match existing app profile and Auth identity. Three active branches belong to one organization without an active organization member.
- Sixteen defined roles. Aggregate role lookup for active profiles found no unmatched role names, but this alone does **not** validate effective permissions or custom-role privilege.
- No public base table lacking RLS or directly SELECT-granted to `anon`. One public SECURITY DEFINER function is executable by `anon`; 279 public SECURITY DEFINER functions are executable by `authenticated`. These require scoped authorization review; a raw count does not establish exploitability.

## Run the audit
```bash
SUPABASE_PROJECT_REF=hvqlkapynjfjikqithvd \
SUPABASE_DB_URL="$SECURE_DATABASE_URL" \
node scripts/readiness/audit-identity-access.mjs --confirm-project=hvqlkapynjfjikqithvd > identity-access-audit.json
node --test scripts/readiness/audit-identity-access.test.mjs
```
Do not commit the real audit output if it contains customer-specific aggregates considered sensitive. The script uses `BEGIN ... READ ONLY` and only outputs aggregate counts and explicit review requirements. Exit 2 indicates blocked access delivery; it does **not** repair any identity.

## Approved resolution per real employee
1. A named client administrator independently verifies the intended staff member, organization, branch, title, and whether the profile is current. Do not assume that old `public.users` records represent active authorized employees.
2. For a valid new account, provision a real Supabase Auth identity using a supported secure invite/activation process; create the corresponding application profile and memberships with the same UUID by the app's established, tested onboarding workflow. **Never** directly update profile IDs to force an email match.
3. For the one email collision, investigate the existing Auth UUID and ownership with a private, authenticated admin flow. Decide a reversible, audited consolidation only after enumerating FK references and testing. No automatic cross-account merge.
4. Only a verified organization owner can approve an organization-member row and a branch grant. Do not automatically insert owner/super_admin memberships into the organization currently missing one.
5. Expired or duplicate profiles must be disabled only after the client confirms and active-session impact is understood. Disabling a profile is not equivalent to revoking existing JWTs.
6. Test with cashier, manager, owner, kitchen and anonymous sessions: expected branch scopes work; cross-organization and unauthorized role elevation fail. Review RLS, SECURITY DEFINER and signup public RPC before release.
7. Rerun this audit, regular production-readiness audit and browser/API regression tests; attach redacted, signed approvals to [issue #262](https://github.com/Premieros/.com/issues/262). Privileged-RPC review is also [issue #263](https://github.com/Premieros/.com/issues/263).

**Delivery decision:** Accounts/permissions are **BLOCKED** until active identities and branches are reconciled. This document does not authorize deleting users, promoting access, or changing production data.
