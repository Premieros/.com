# PremierOS Branch Hub — foundation (NOT production-ready)

This is the **initial local branch gateway**, not a complete offline POS or Windows installer. It keeps an idempotent SQLite print-job queue, provides a local health endpoint, and deliberately does not print or synchronize financial records yet.

Requires Node.js >=22.13 (bundling as a Windows installer is a later stage).

## Loopback smoke test

Set BRANCH_HUB_ORGANIZATION_ID (organization identifier), BRANCH_HUB_BRANCH_ID (unique branch identifier) and BRANCH_HUB_TOKEN (random 32+ character secret), then run `node branch-hub/server.cjs`. Default bind: 127.0.0.1:3847. DB lives under APPDATA/PremierOS/BranchHub/<branch id> on Windows. Never put the secret in client-side JavaScript or in a QR code.

## Secure LAN mode

Set BRANCH_HUB_HOST=0.0.0.0, BRANCH_HUB_TLS_CERT, BRANCH_HUB_TLS_KEY, and BRANCH_HUB_TOKEN. LAN bind is rejected without TLS. Install a certificate trusted by tablets/phones. Configure Windows firewall for branch subnet only. Device pairing, per-device credentials, revocation, persistent authenticated sessions, and a certificate provisioning UX are NOT YET implemented; the shared token is for controlled developer testing only. Do not expose the server to the internet.

## Roadmap / production acceptance gates

1. Package Windows installer/service with SQLite backups, encryption at rest, migration/versioning, startup recovery and printer worker.
2. Build local branch APIs for sales, orders, payments, stock and journals, all atomic, audited, idempotent and branch scoped; retain server-side authority on local hub.
3. Serve the entire PremierOS frontend locally and support offline login, permissions and same-LAN phones/tablets; device pairing with rotation/revocation.
4. Durable outbox/inbox and deterministic cloud synchronization with strict ownership and conflict rules; verify double-apply prevention.
5. Simulate WAN loss and restart; multi-device concurrent transactions and print receipts; restore from backup; security/load test before production.

Current app offline IndexedDB data and cloud Supabase RPCs do **not** satisfy these gates.

## Permanent branch binding (foundation)

The first startup stores the organization and branch identity in the local SQLite database. Later startup refuses a different identity for that same data directory. New print-job submissions must include matching `organizationId` and `branchId` and fail with `BRANCH_SCOPE_MISMATCH` otherwise. This is a defense-in-depth guard **not secure server-side enrollment**: the configuration must ultimately be issued by the cloud after the administrator authenticates, signed, stored securely, and tied to a registered device. Changing branch requires an explicitly audited re-enrollment/migration workflow; never point another branch at an existing data directory.

Remote app updates, offline full ERP, printer execution, and synchronization are still not implemented by this foundation.
