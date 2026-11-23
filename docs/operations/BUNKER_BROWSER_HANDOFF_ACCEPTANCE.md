# BUNKER — Online Browser Handoff Acceptance Gate

Scope: browser-only release for BUNKER. **This document is not evidence of a successful end-to-end test.** Do not claim delivery ready until each required scenario has a dated run, order ID, expected/actual results, and an owner.

## Existing automated checks

- `tests/components/bunker-fulfillment-acceptance.test.tsx`: guest displays for dine-in, pickup, delivery and accepted-unsent.
- `tests/unit/bunkerKitchenStationDispatch.test.ts`: station separation, partial cloud fallback, reporting partial failure, unassigned items, empty sends.
- `tests/components/qr-public-menu.test.tsx`: pending staff approval and client retry key after ambiguous network failure.

These component/unit tests use mocks. They do not prove that database persistence, real browser sessions, KDS delivery, or payment posting work.

## Required end-to-end run (record run ID and screenshot/video or DB evidence)

1. Open **independent sessions** for cashier, kitchen, barista and three captains; keep each session logged in with its intended branch/role.
2. Captain 1 creates a dine-in order containing a food item and a coffee. Record order ID and table number; check only food appears on kitchen and only coffee on barista.
3. Captains 2/3 update separate tables concurrently. Refresh all sessions and confirm no missing/duplicate lines.
4. Customer opens branch site -> Order Now -> Dine-in; QR table session creates a pending request. Confirm kitchen/barista see **nothing before cashier acceptance**.
5. Cashier rejects one customer request: confirm rejection on customer page, no kitchen send, no invoice.
6. Customer retries, cashier accepts and edits order; confirm one order/ticket per destination and synchronized status on customer page.
7. Repeat with website Delivery and Pickup, including delivery dispatch and pickup ready/collected states. Check no table assignment for delivery/pickup.
8. Retry a request after interrupted network/refresh with same idempotency key; confirm no duplicated orders or debits.
9. Complete cash, card, split payment, refund and shift close; reconcile payment rows, source order mapping, journal and stock ledger.
10. Verify negative stock branch policy and actual sale completion for depleted demo item; ensure all validation except stock shortage still holds.
11. Document browser disconnection behavior: **do not claim offline sales are supported** by the online handoff.
12. Review station/category mapping, permissions, RLS, access by other branches, backups, rollback and print integration.

## Blocking gates

- Destination mapping currently needs separate sign-off: categories all mapped to `main` at a prior database inspection; retest current mapping, do not modify production silently.
- Never remove or alter historical payments/ledgers in a cleanup by deleting only invoices. Preserve pre-test snapshot and uniquely tagged test order IDs.
- Release only when CI succeeds on head SHA and every practical scenario has a PASS record. A green PR alone does not authorize production changes.
- Any order that bypasses cashier approval or routes to the wrong KDS station blocks handoff.
- Offline LAN sync / Windows is a later upgrade, not included in this online acceptance.

## Evidence template

| UTC timestamp | Tester / role | Scenario | Order IDs | Expected | Actual | PASS/FAIL | Evidence ref |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
