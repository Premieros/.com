# Premier OS — post-reset customer handoff (19 November 2026)

**Decision:** CLEAN OPERATING BASELINE; **NOT YET ACCEPTED FOR LIVE CUSTOMER HANDOFF**.

Production project: `hvqlkapynjfjikqithvd`. Repository: `Premieros/.com`. UI: `https://premieros-sage.vercel.app/#/login`. Last verified release before this audit: `cecf839a8b8870b6bc708ac50b6f72b459d4c002` (all seven build, verify, db, browser-smoke, readiness, production-parity and deploy checks succeeded, plus Vercel status success).

## Evidence: read-only verification after approved operational reset
- Protected catalog: **513 products**, **812 raw materials**, **510 recipes**, **2,172 recipe lines**, **37 inventory units**. **41 user profiles**, **9 branches** and **8 warehouses** retained.
- **0** sales, orders, purchases, journals, stock ledger entries, raw stock batches/balances, inventory unit batches, shifts, FIFO debts, raw warehouse balances, sale idempotency records and ERP outbox rows.
- **0** nonzero customer or supplier balances, **0** nonzero treasury opening balances, **0** document sequences not equal to their new-start value, **0** occupied dining tables. **499** tables vacant; **1** table deliberately closed according to its retained setting.
- **29 active profiles without a matching Supabase Auth identity** and **3 branches with no active organization member** remain. These require identity/organization review, not bulk fabricated accounts or random ID reassignment.
- No public tables lacking RLS, and no anonymous SELECT grants were seen in the most recent direct check. Security checks of privileged RPCs and signup abuse protections remain unverified, not silently approved.

The historical 146 negative material balances and 6,424 negative batches are **no longer live** because the owner explicitly authorized deletion of operational balances. Never keep using these obsolete numbers as the current delivery blocker. The absence of historical inventory does **not** prove POS stock consumption, valuation, or receipts are correct.

## Run read-only post-reset gate (production-safe)
```bash
SUPABASE_PROJECT_REF=hvqlkapynjfjikqithvd \
SUPABASE_DB_URL="$SECURE_DATABASE_URL" \
node scripts/readiness/audit-post-reset.mjs --confirm-project=hvqlkapynjfjikqithvd > post-reset-audit.json
node --test scripts/readiness/audit-post-reset.test.mjs
```

A `CLEAN_BASELINE` or `CLEAN_BASELINE_ACCESS_REVIEW` result means no transactional data was observed in the sampled tables. **Neither authorizes customer delivery**, live charging or stock mutation. Any new transaction after this reset correctly changes status to `RESET_INCOMPLETE`: stop using the empty-baseline check once the customer starts operations, and use the normal production-readiness audit instead.

## Mandatory acceptance on authorized isolated test tenant
- Invite and verify real cashier, manager and organization-owner identities. Confirm cross-tenant and cross-branch denial; resolve the 29/3 gaps with authorized owners. Link issue [#262](https://github.com/Premieros/.com/issues/262).
- Load a small, **documented test opening stock** in isolated tenant; purchase receipt then sale then refund, demonstrate correct raw and unit batches, no negative stock or silently re-created FIFO debt, and balanced journals. Customer's production opening stock requires a physical count, independent customer-approved values and signed acceptance.
- Two cashiers simultaneously and replay after timeout: no duplicate invoices, payments, stock movements or journal lines. Test shift open/close, cash reconciliation, kitchen sends, print, barcode and offline/online recovery on contracted devices.
- Verify restore of **data-bearing** backup and measure RPO/RTO. Record actual device/provider/tax integration evidence if in scope.
- Review anonymous trial registration `SECURITY DEFINER` and password security; link issue [#263](https://github.com/Premieros/.com/issues/263). Avoid breaking signup in production without a tested change.
- Record operational acceptance results, rollback owner and support rota in issue [#264](https://github.com/Premieros/.com/issues/264).

## Release handoff decision
Run `scripts/readiness/audit-production.mjs` and the independent `scripts/readiness/audit-identity-access.mjs` before using `scripts/readiness/evaluate-handoff.mjs`. The handoff gate now **requires three inputs**: `readiness-audit.json`, `handoff-evidence.json`, and `identity-access-audit.json`, in that order. Access audit must have `TECHNICAL_ACCESS_CHECKS_PASS` and no access REVIEW/BLOCKER items, or delivery remains `NOT_READY`. The current production counts (29 unmatched active staff profiles, three branches without organization members, one anon privileged RPC) cannot be overridden with a generic success attestation. Collect **real evidence** after all customer acceptance tests. The older `inventory_negative_balance_signoff` evidence key now means **documented zero/opening-stock baseline acceptance plus demonstrated first receipt and sale**, not a claim that deleted historical balances still exist. Never fabricate a PASS record. Customers should receive credentials only via secure invite or reset flows, never in GitHub.

**Safety:** The post-reset audit performs no writes; this document does not enable production provisioning or make a claim of live POS acceptance.
