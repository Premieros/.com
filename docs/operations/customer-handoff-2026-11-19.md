> **Post-reset update (19 Nov 2026):** After the owner-approved operational reset, the earlier 146 negative balances/6,424 negative batch rows and cancelled CI check remarks below are historical, **not current production readings**. For the authoritative new zero-operations baseline and current delivery blockers, see [post-reset-customer-handoff-2026-11-19.md](post-reset-customer-handoff-2026-11-19.md). The release commit `cecf839a8b8870b6bc708ac50b6f72b459d4c002` subsequently passed all seven GitHub checks. The 29/3 identity and membership gaps remain unresolved.\n\n# Premier OS — delivery acceptance pack (19 Nov 2026)

**Current decision: NOT READY for unconditional customer handoff.**
This is a transparent, reproducible handoff package, not a release certificate. Production is the Supabase project `hvqlkapynjfjikqithvd`; repository `Premieros/.com`; application `https://premieros-sage.vercel.app/#/login`. Commit at start of audit: `28a2c91c0055e399777a5d600fa86539fad7cc4f`.

## Evidence gathered (read-only 19 Nov 2026)
- Deployment Vercel commit status **success**. Build/readiness/deploy/production-parity checks **success** on the referenced commit, but `verify`, `db` and `browser-smoke` were **cancelled** on that commit. They must be rerun and pass for the candidate actually delivered.
- `raw_fifo_debts`: 0; `raw_fifo_settlements`: 0 (old debt records intentionally deleted, not restored).
- Raw-material balances: 146 negative balances; 6,424 negative batch rows. Treat as historical **review and inventory acceptance issue**, not an orphaned-debt blocker. No automatic stock reset.
- 29 active app profiles without matching Auth identity; three branches without active organization member. Map each to approved archival/disabled/service status or fix using authenticated identity workflows and prove tenant access.
- Accounting/integrity SQL: 0 unbalanced journals (including posted), 0 journal entries without lines, 0 orphan sale items/payments/journal lines, 0 duplicate invoice groups, 0 aggregate stock/batch mismatches, 0 public tables without RLS.
- Supabase security advisors: 1 anon-executable SECURITY DEFINER warning, 279 authenticated-executable SECURITY DEFINER warnings, 1 leaked-password-protection warning. These are review candidates, not automatically proven vulnerabilities. See [SECURITY DEFINER advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- No signed evidence of completed restore rehearsal, independent tenant abuse testing, device tests, payment/tax integration approval or concurrency/idempotency load tests was located in this audit. Treat as **not verified**.

## Required acceptance evidence (signed by owner, timestamped, and linked to test report)
1. **restore_rehearsal**: backup exists; restore to isolated data-bearing environment; counts, totals, schema and RPO/RTO verified.
2. **cashier_sale_refund_shift**: paid and split sale, cancellation/full and partial refund, kitchen flow, shift open/close, cash reconciliation and journal balance.
3. **concurrent_retry_idempotency**: same request replayed after timeout; two terminals submit concurrently; stock, payment and journal exactly once.
4. **tenant_role_isolation**: unauthorized branch/organization access denied for cashier, manager, owner and admin; no privilege escalation.
5. **security_rpc_review**: privileged RPC permission, membership, `auth.uid()`, search path and anon registration abuse control checks; leaked-password protection reviewed.
6. **inventory_negative_balance_signoff**: client formally acknowledges or reconciles 146 negative balances, 6,424 negative batches, and demonstrates new stock/receipt correctness.
7. **device_offline_online**: printer/KDS/barcode flow and offline recovery on target terminals, without duplicate sales.
8. **operations_rollback_monitoring**: named operator, incident channel, support contacts, alerts, release rollback and database compensating plan. A Vercel rollback does **not** undo DB writes.

If tax, e-invoicing, or delivery providers are in contracted scope, also require written environment/provider-specific approvals and tests before enabling them. Do not claim compliance from a successful build.

## Generate handoff gate decision
1. Run the existing production read-only audit using credentials supplied only through a secure runner:
```bash
SUPABASE_PROJECT_REF=hvqlkapynjfjikqithvd \
SUPABASE_DB_URL="$SECURE_DATABASE_URL" \
node scripts/readiness/audit-production.mjs --confirm-project=hvqlkapynjfjikqithvd > readiness-audit.json
```
2. Prepare `handoff-evidence.json` with keys listed above, each in form
```json
{"restore_rehearsal":{"result":"PASS","owner":"actual responsible person","reference":"link or ticket to signed evidence","checked_at":"2026-11-19T08:00:00Z"}}
```
Add real values for *all* keys; never fill missing evidence with invented passes. Keep sensitive logs and credentials out of committed evidence.
3. Run `node scripts/readiness/evaluate-handoff.mjs readiness-audit.json handoff-evidence.json`. Exit 0 = all audit checks PASS and signed evidence present; exit 2 = not ready; exit 1 = invalid inputs. This tool **does not modify production**, and even a PASS requires the release owner to approve the precise target, legal requirements, support arrangement, and delivery record.

## Client-facing handover checklist
- Product URL and release commit, named customer organization and assigned initial admin.
- Role-based credentials delivered through secure invitation/reset link, **never** passwords inside GitHub, chat, or the handoff report.
- Branch, warehouse, tax profile, cashier shift, inventory opening balances and printers configured for that specific customer.
- Training and acceptance of sale, refund, shift, purchase, inventory and reporting workflows.
- Signed outstanding-issues list, rollback owner, support contact, onboarding date, warranty/SLA arrangements.

## Scope guard
Do not mutate `johnas` / other Supabase projects. No historical debt recreation, silent zeroing of stock, deleting accounting data, broad RLS changes, automatic account creation or live payment/tax provider activation. Fix critical findings on an isolated environment, prove with tests, then deploy through an approved PR.
