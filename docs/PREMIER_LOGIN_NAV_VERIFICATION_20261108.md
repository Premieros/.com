# Premier baseline UI verification unblock — 2026-11-08

**Status:** Draft repair, not merged or published. No database writes, migrations, permissions grants, sales, stock, printers or production deployment.

## Observed evidence

The full Verify workflow on POS PR #136 HEAD `ea27ed780200847ab305b8bcf464792a2df4ffe8`, run `42518231582`, failed **3 unit tests**:
- `tests/components/pages.smoke.test.tsx`: LoginPage calls `window.matchMedia` when this API is absent in jsdom.
- `tests/unit/stock-count-opening-navigation.test.ts`: direct permission-scoped navigation entries for stock count and opening balances were missing from MENU_ITEMS despite both canonical routes and module mappings existing.

## Exact changes

- Guard the `matchMedia` reduced-motion lookup with a function-type check. Normal browsers continue respecting reduced-motion preference. This does not bypass authentication.
- Add `stock-counts` with `inventory.view` and `opening-balances` with `accounts.view` to the existing center-menu configuration. Keep existing module access and organization module gates; no new data permission or endpoint introduced.
- Existing smoke/navigation regression tests assert intended behavior and must pass on the independent PR's exact HEAD.

## Release gates
Run full Verify, DB integration, browser smoke; review menu visibility for owner/admin/unauthorized user and reduced-motion behavior. Do not claim this repairs every failing test until CI confirms. Keep this PR separate from POS financial and Windows update branches.
