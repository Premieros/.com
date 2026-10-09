# Phase 1C — API Security Audit

## Verified production state

- No authenticated-executable SECURITY DEFINER function with a leading underscore remains.
- No authenticated-executable SECURITY DEFINER trigger function remains.
- Every public-schema SECURITY DEFINER function has an explicit search_path configuration.
- Anonymous SECURITY DEFINER exposure remains limited to the intentional public onboarding function `register_trial_tenant(...)`.

## Default privilege finding

`postgres` default function privileges in `public` are already restricted to postgres/service_role.

`supabase_admin` still has default function EXECUTE grants for anon/authenticated. An attempt to alter those defaults through the available MCP connection was rejected with `permission denied to change default privileges`.

This was not bypassed. It remains an owner/dashboard-level hardening action.

## Remaining authenticated SECURITY DEFINER warnings

Supabase still reports a large set of authenticated SECURITY DEFINER functions. Many are supported business/read APIs used by the application.

The remaining work is caller classification and API contract consolidation, not blind revocation.

## Decision

Phase 1C does not revoke business RPCs without caller proof.

The next architecture work proceeds with additive compatibility layers while the public API inventory continues to be reduced incrementally.
