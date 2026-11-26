# PR #318 — operational acceptance gate

Status: **not signed off**. Automated tests on disposable PostgreSQL and Chromium are not a replacement for authenticated physical-device acceptance. Do not deploy solely on a green CI status. Use an authorized test branch/environment and synthetic transactions; do not write test data into a live restaurant. Record exact commit, environment, tester, timestamp, actual result and evidence. No production credentials, customer data, or secrets in this document.

| ID | Scenario | Required evidence | Status |
|---|---|---|---|
| A01 | Product wizard: ready, raw-only, manufactured-only, mixed; select component then save without pressing Add | Reopen in product and recipe views; correct type, IDs, quantities and cost | Pending |
| A02 | Edit mixed product, sale units and price; remove last component; competing editor | Persisted values; stale rejection; previous state intact after induced failure | Pending |
| A03 | Branch-limited product editor, recipe manager, admin and unauthorized branch | Allowed metadata save, denied unauthorized changes, preserved links and branch isolation | Pending |
| A04 | Legacy product BOM add/edit/delete, duplicate and cycle rejection | Reopen saved rows, no cycles, no partial metadata save | Pending |
| A05 | Draft count raw/product/mixed, zero, blank, additions/removal, stale concurrent editor | Exact quantities; original snapshots; no stock movement before apply | Pending |
| A06 | Submit/approve/apply count, retry; verify inventory and journal | Correct warehouse, one application, balanced journal | Pending |
| A07 | Purchase/receive/return and warehouse transfer with partial/failure cases | Actual batches, balances, movement references, accounting reconciliation | Pending |
| A08 | Sales including cash, split/manual transfer approvals, discounts/refunds, offline recovery | Unique settlement, correct tender totals, balanced journals, no double consumption | Pending |
| A09 | Independent cashier, captain, KDS kitchen and bar, customer QR on separate sessions | Food routed to kit, coffee to bar, branch isolation, correct order lifecycle | Pending |
| A10 | Windows print agent and actual printers; offline/online retry | Physical kitchen/bar receipts once; pending jobs explained without automatic replay | Pending |
| A11 | Pre/post-release read-only audit; canonical inventory discrepancy | Linked debt not deducted twice; no changes to stock history; no new blocking mismatch | Pending |
| A12 | Release control | Exact tested SHA, migration history verified, single authorized deploy, Vercel no-overage lock restored | Pending |

Signoff requires all applicable scenarios passed or a documented explicitly accepted exception. Stop on any financial, inventory or authorization failure. No production deployment or device acceptance performed from this PR alone.
