# Premier — Production go/no-go runbook (2026-11-18)

## Release policy
**Current decision: NO GENERAL GO.** Keep any real-money launch gated until the signed evidence below is attached. Current GitHub builds and Vercel READY are necessary, not sufficient. This runbook does not authorize real-money writes or edits to historical stock/accounts.

## Read-only observed snapshot (canonical Supabase: hvqlkapynjfjikqithvd)
- Deployment: Vercel READY, production SHA 22bc5dd9a79cd1e1a0550ee0900ffcdf295b0f30.
- Supabase project: ACTIVE_HEALTHY, 147/147 public tables with RLS, 0 public tables with SELECT granted directly to anon.
- 1,254 sales; 1,332 orders; 2,255 journal entries; 21,882 inventory ledger rows.
- 0 duplicate (branch, invoice number) groups, 0 orphan sale-item/payment/journal-line records, 0 unbalanced entries and 0 posted entries with debit/credit differences above 0.005.
- 146 negative raw-material balances across 2 branches. **All 146 have outstanding FIFO debt**; 6,459 unresolved raw FIFO debt records. Do not clamp negative balances to zero or invent purchase receipts.
- Raw stock projection matches the warehouse-v2 balance (533 rows, 0 mismatches in the checked join). This is a consistency check, not physical inventory proof.
- 29 active application user profiles have no matching Supabase Auth identity; 3 branches have no active organization member. Some may be legacy data, but active employee login coverage is not demonstrated.
- 0 entries in public.inventory (legacy ready-product balance table): investigate whether all live ready-stock is kept exclusively in newer ledgers.
- Supabase advisors: 1 public SECURITY DEFINER trial-tenant registration RPC executable by anon (may be intentional registration), 279 authenticated SECURITY DEFINER notices requiring a security review of each privileged entry point; compromised-password protection warning; 19 auth RLS initplan warnings, 82 multiple permissive policy warnings and 185 foreign keys without covering indexes. These warnings are audit candidates, not proof of exploit.
- PostgreSQL archive_mode=on, but **this does not prove a restorable backup**.

## Run the repeatable read-only aggregate audit
This script is **not** called by CI or the application. Use a trusted administrative machine or an ephemeral secure runner, never from a public browser. It refuses a connection URL that does not match the expected Supabase ref in hostname or pooler user, requires explicit ref confirmation, starts a PostgreSQL READ ONLY transaction, and emits aggregate counts only.

Set credentials only through the secure runner's secret store; never paste database passwords into chat or commit them.

    SUPABASE_PROJECT_REF=hvqlkapynjfjikqithvd \
    SUPABASE_DB_URL="$SECURE_DATABASE_URL" \
    node scripts/readiness/audit-production.mjs --confirm-project=hvqlkapynjfjikqithvd > readiness-audit.json

Exit 0 means no SQL-detected blocker, **not** authorization to go live. Exit 2 means one or more SQL-detected blockers. Exit 1 means the audit failed. The output always flags six unverified operational gates.

## Gates to sign off before using as system of record

| Gate | Pass evidence | Owner |
| --- | --- | --- |
| FIFO / inventory | Explain 146 negative rows, reconcile 6,459 unresolved FIFO debt records against physical counts, receipts and source sales, prove ledger-vs-stock and COGS under shortage and replenishment; apply only audited corrective entries | Inventory + accounting |
| Accounts / tenant isolation | Map each of 29 active profiles without Auth identities and 3 membership gaps to legitimate legacy/service records or provide authenticated users; test cashier, manager, owner, super admin and unauthorized other-branch on separate tenant fixtures | Security + operations |
| Privileged RPC | Review anon trial registration rate limiting / abuse protections and authenticated SECURITY DEFINER functions for internal auth.uid, branch checks, parameter handling and positive/negative tests. Don't blanket-revoke needed RPCs | Security |
| Cashier end-to-end | In disposable environment run paid split sale, inventory decrement, balanced journal, shift cash, replay same client operation, concurrent double-submit, partial/full refund and rollback on failure | POS + accounting |
| Recovery | Prove real backup exists in provider settings; restore to isolated database, run schema/row/financial checks, record RPO, RTO, date, operator and restore logs. Never test restore against production | Infrastructure |
| Devices & resilience | Printer and KDS receipt/order print tests, offline/online transitions, two simultaneous terminals, bounded response-time/load test with rollback plan | Operations |
| Tax / delivery | Separate written provider approval and end-to-end compliance testing before enabling any live provider connection | Integrations |

## Pilot limits
Only after critical gates pass, authorize a named pilot branch with a daily reconciliation checkpoint, manual fallback, monitored error/log baseline and an immediate rollback owner. A Vercel rollback does not reverse already committed database writes. Confirm migration compatibility separately.

## Operational monitoring
- Daily: unmatched sales/payments, posted journal balance, negative stock/FIFO debt changes, failed transactions, open shifts, auth failures and branch access.
- Weekly: Supabase security/performance advisers; dashboard logs, dependency alerts, restore rehearsal status, API error rates, and role-permission drift.
- After any incident: capture anonymized operation ID, branch scope, timestamp and sanitized error; never capture tokens, PINs, payment credentials or user PII in audit output.

No production writes or automatic reconciliation are performed by this audit.
