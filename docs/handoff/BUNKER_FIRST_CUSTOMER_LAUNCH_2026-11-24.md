# BUNKER — First real customer delivery (24 November 2026)

**Updated:** 2026-11-22 (Africa/Cairo)  
**Target delivery:** Tuesday 2026-11-24  
**Real customer/branch:** BUNKER only (`d56aae83-f1b3-4153-9224-87594500368d`). Other branches are test/demo and must not be counted as customer blockers unless they reveal a shared software vulnerability.  
**Owner clarification (2026-11-22):** BUNKER has **no approved real menu and no actual staff accounts yet**. **All current products/items are demo/test data**, regardless of the previous technical adoption of 15 demo records into the live product catalog. Never treat their presence or provisional prices as business approval.

## Decision
- **Software installation, demonstration and configuration handover** may be staged, if access/security and hardware readiness conditions are met, but **NOT real trading / live customer QR orders** until actual customer inputs, authorized staff, end-to-end tests and sign-off are complete.
- QR/customer intake remains in preview/simulation until expressly authorized. Do not enable real transactions just to meet the delivery date.
- No automatic fabrication of staff identities, ingredients, product costs, prices or opening stock. Do not silently delete or repurpose sample items before a documented scope/backup and owner approval.
- No production database mutations under this checklist.

## Day-one delivery: what *software team* can prepare now
- [ ] Confirm BUNKER organization, branch, warehouse, tables, stations and scope (read-only audit).
- [ ] Verify first-owner invitation and staff onboarding pathway in an isolated environment, with role/branch restrictions; avoid any hard-coded/test credentials.
- [ ] Provide a clean, controlled *demo vs live* catalog process; distinguish and safely hide sample items from customer-facing live menus until actual list is approved.
- [ ] Verify sale / refund / shift / receipt / KDS / printing / offline re-sync using sandbox/test data and actual contracted hardware.
- [ ] Verify BUNKER website/domain and customer QR link route only to BUNKER, with no Premier admin route exposure.
- [ ] Test backup restoration on isolated data-bearing environment; record real evidence, rollback owner, support contact.
- [ ] Produce customer handoff: URL, versions, setup guide, training, scope, support channels, unresolved items, signatures.

## Customer-required inputs (cannot be invented)
- [ ] Actual approved menu: item names, categories, retail prices, units, options and descriptions/allergens supplied by customer.
- [ ] Kitchen-produced recipe/BOM and material quantities **or** approved stock-tracked per-item policy; actual costs and taxes.
- [ ] Approved starting balances based on physical count, if inventory is in scope.
- [ ] Named real staff roster: manager, cashier, kitchen, and intended roles/branch access; each person securely invited and verified.
- [ ] Printer models/location, tablets/terminals/network, testing and staff training schedule.
- [ ] Signature authorizing operational launch, including live QR ordering if enabled.

## Hard blockers to a *live* launch (not to software demo/handoff)
1. No real menu (all 15 known BUNKER catalog items are demo/provisional; user explicitly confirmed all current items are trial).
2. No real authorized staff accounts or active verified organizational ownership for BUNKER.
3. No customer-provided recipes/costs/opening quantities; earlier report describes empty warehouse and 15 zero-cost items, to be revalidated before any live action.
4. No witnessed customer order → reviewer → kitchen → payment/receipt → shift → refund and offline/recovery acceptance on real hardware.
5. Domain separation and recovery rehearsal not signed off; follow `docs/handoff/BUNKER_GO_LIVE.md` and the acceptance worksheet.

## Recommended 24 Nov handoff model
**Phase A (conditionally deliverable):** demonstrate BUNKER-configured software, record signed list of pending customer inputs, document support/training and ownership, keep all live intake gates OFF.  
**Phase B (later, only after inputs and UAT):** provision approved real identities, import/approve real catalog and BOM, stock opening, test real hardware in safe mode, sign go-live, then enable only BUNKER live operations.

## Test evidence register
| Gate | State as of 2026-11-22 | Required evidence |
| --- | --- | --- |
| Real menu prices + recipes | BLOCKED — client inputs absent | Signed menu & production sheets |
| Staff provision / permissions | BLOCKED — staff roster absent | Named roster, authenticated invitations, access test |
| Branch QR live intake | OFF / not approved (per previous handoff) | Real devices + end-to-end signed rehearsal |
| Printer/KDS/offline | NOT ACCEPTED | Branch hardware log and screenshots |
| Tenant isolation/security | REVIEW REQUIRED | Authorized role/tenant regression |
| BUNKER domain separation | NOT VERIFIED COMPLETE | Vercel project-domain ownership and route test |
| Restore/monitor/rollback | NOT ACCEPTED | Timed restore, evidence, named operator |

**Source-of-truth note:** Prior `BUNKER_GO_LIVE.md` says 15 demo products were *technically adopted* into catalog on 21 Nov. The business owner clarified on 22 Nov that they remain **demo-only from a business standpoint**. Technical adoption ≠ customer-approved menu. Future reports must follow the latter distinction.
