# PR #316 — Remediation and merge log

Started 2026-11-24. Reviewed head: `74a65abbe0f9da54a7e2c5fa45865d05608eb921`. Target: main.

OPEN = unresolved; CODE = patch committed, verification pending; PASS = recorded verification; BLOCKED = requires evidence or authorization. Update this log after each batch and record final head, CI run IDs, acceptance evidence and merge SHA. No production writes, Vercel deployment, budget change or station remap authorized.

| ID | Priority | Work item | Status |
|---|---|---|---|
| R01 | P1 | Bind discount approval to sale/cart, server-side scope and single consumption | OPEN |
| R02 | P2 | Recover missed approval events and expose RPC failures | OPEN |
| R03 | P1 | Isolate user settings and invalidate stale async writes/cache | OPEN |
| R04 | P1 | Bind journal status and reversal confirmation to selected entry | OPEN |
| R05 | P1 | Make invoice metadata/payment saves explicitly independent or atomic | OPEN |
| R06 | P1 | Financial RPC/column grants, ledger and refund integration verification | OPEN |
| R07 | P1 | Kitchen/barista explicit staff assignment and least privilege | BLOCKED |
| R08 | P2 | QR recovery enabled in both branches: cross-branch denial | OPEN |
| R09 | P2 | QR check-in/recovery toggle policy | OPEN |
| R10 | P2 | Business day versus browser calendar date | OPEN |
| R11 | P2 | Stable sales pagination under concurrent inserts | OPEN |
| R12 | P2 | Historical station remap NULL guard and concurrency | OPEN |
| R13 | P1 | Independent cashier/captain/kitchen/barista/customer browser acceptance | BLOCKED |
| R14 | P1 | Backup/restore checkpoint and financial reconciliation | BLOCKED |
| R15 | P1 | Final head CI and review; merge only when gates satisfied | OPEN |

## Timeline
- 2026-11-24: Baseline static review of 56-file diff; four successful workflows on original head. Existing production reports are documentation, not newly verified live evidence. No production changes.
