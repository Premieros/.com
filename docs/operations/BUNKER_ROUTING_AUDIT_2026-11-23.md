# BUNKER online release — live database routing audit

Audit time: 2026-11-23 (read-only SQL). Branch UUID: `d56aae83-f1b3-4153-9224-87594500368d`.

**Verdict: NOT READY for split kitchen / barista acceptance.** Green unit/component checks are not a full live cashier -> kitchen/barista demonstration.

## Read-only findings

- **Kitchen stations**: 9 active. Codes: `dessert`, `drinks`, `fryer`, `grill`, `kit`, `main`, `salad`, `بار`, `كاش`.
- **All five current category assignments use `main`**:
  - Burgers: 4 products
  - Desserts: 2 products
  - Hot Coffee: 3 products
  - Iced Coffee: 3 products
  - Sides: 4 products
- **Observed kitchen sends**: 4 rows total, all routing through category `main` (dine-in: 3 sends / 4 units; delivery: 1 send / 1 unit).
- **Unfinished orders**: 3 orders in open/held states, including **1 already sent to kitchen**.
- **Auth**: 1 valid auth-linked user with branch access, 1 valid active org auth-linked member. This does not establish distinct logged-in cashier, kitchen, barista, captain sessions.
- **Negative stock**: `effective_allow_negative_stock(branch_id)` returned `true`.
- **Guest intake**: `qr_private.branch_settings.enabled` and `checkin_enabled` returned `true`; these do not prove customer staff approval or KDS delivery.

## Remediation before final acceptance

1. Verify intended code of physical **barista KDS** (likely `drinks` or `بار`) and **kitchen KDS** (likely `kit` or `main`), based on actual branch roles and permission grants, not labels alone.
2. Confirm whether `Desserts` and `Sides` require separate sections or kitchen. Approved customer real menu will replace demo categories eventually.
3. Complete or safely close the 3 unfinished demo orders **through supported business workflows** before remapping categories, since remapping may alter where already-sent tickets appear.
4. Once station mapping is approved, apply a **BUNKER-only** database change using the supported station-assignment service/transaction, recording before/after evidence. Do not bypass branch scope or mutate other branches.
5. Run independent authenticated browser sessions for cashier, kitchen, barista and captain(s). Send mixed burger+coffee order, verify unique ticket per station and status progression.
6. Validate customer website/QR pending -> cashier review -> accepted/declined -> KDS; retry, payments, refund, shift close, reconciled financial records.
7. Capture a backup/restore checkpoint and audit the dependency graph before any trial-data cleanup.

## CI evidence

- `Verify main` run [45125094693](https://github.com/Premieros/.com/actions/runs/45125094693): success for commit `893d6146be2c477dcc1f3f4a12da490df04f52c1`.
- `Fast Verify` run [45124965827](https://github.com/Premieros/.com/actions/runs/45124965827): success for same commit.
- The tests are mocked at service/component level; this audit uses actual read-only branch data. Neither alone proves multi-browser end-to-end behavior.

**Production mutation status:** none performed during this audit. No sale created, order modified, user provisioned, station remapped, or test data deleted.
