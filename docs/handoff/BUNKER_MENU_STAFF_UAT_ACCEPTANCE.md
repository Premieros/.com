# BUNKER — menu and operational acceptance worksheet

**Branch:** BUNKER · **Current catalog:** 15 products · **Currency:** EGP  
**Status:** Branch prices are the former demo prices, adopted as provisional catalog values on 2026-11-21. **NOT verified or approved for live sales.**

## Approve current products and prices
Tick the 3 checks for each item only after verifying the price, allergens/description, and stock/recipe + actual cost.

| # | Product | Category | Current price (EGP) | Price approved | Description/allergens approved | Recipe and cost entered |
| --- | --- | --- | ---: | :---: | :---: | :---: |
| 1 | Classic Smash Burger | Burgers | 165.00 | ☐ | ☐ | ☐ |
| 2 | Crispy Chicken Burger | Burgers | 150.00 | ☐ | ☐ | ☐ |
| 3 | Double Cheeseburger | Burgers | 210.00 | ☐ | ☐ | ☐ |
| 4 | Smoky BBQ Burger | Burgers | 185.00 | ☐ | ☐ | ☐ |
| 5 | Chocolate Brownie | Desserts | 100.00 | ☐ | ☐ | ☐ |
| 6 | Chocolate Chip Cookie | Desserts | 75.00 | ☐ | ☐ | ☐ |
| 7 | Cappuccino | Hot Coffee | 95.00 | ☐ | ☐ | ☐ |
| 8 | Double Espresso | Hot Coffee | 70.00 | ☐ | ☐ | ☐ |
| 9 | Flat White | Hot Coffee | 100.00 | ☐ | ☐ | ☐ |
| 10 | Cold Brew | Iced Coffee | 115.00 | ☐ | ☐ | ☐ |
| 11 | Iced Latte | Iced Coffee | 110.00 | ☐ | ☐ | ☐ |
| 12 | Iced Mocha | Iced Coffee | 125.00 | ☐ | ☐ | ☐ |
| 13 | Classic Fries | Sides | 70.00 | ☐ | ☐ | ☐ |
| 14 | Loaded Cheese Fries | Sides | 115.00 | ☐ | ☐ | ☐ |
| 15 | Onion Rings | Sides | 85.00 | ☐ | ☐ | ☐ |

**Signing manager:** _____________________   **Date:** _______________

> A visible product description is not an inventory recipe. Do not invent ingredient quantities, expiry dates, allergen guarantees or purchase cost from marketing descriptions. Enter these from kitchen production sheets.

## Kitchen and inventory setup

- [x] One **empty** receiving warehouse has been created: BUNKER Main Stock. No physical quantities have been created.
- [x] Five categories are routed to the existing active kitchen station `main` (routing is provisional; reassign coffee/desserts if the kitchen lead prefers).
- [ ] Owner or stock controller performs opening-stock count, confirms suppliers/UOMs and posts opening balance using Premier's approved inventory flow.
- [ ] Kitchen lead records actual ingredients, unit quantities, wastage, purchase cost and approved recipe per item.
- [ ] Manager reviews taxes, prices, discounts, refunds, dine-in/delivery modes and receipt numbering.
- [ ] Manager checks customer-facing product descriptions (allergens and customizations are not yet validated).

## Access roster — to be filled and authorized by management

| Staff identity / verified email | Intended role | Branch access | QR review permission | Staff acceptance |
| --- | --- | --- | --- | --- |
| __________________________ | Branch manager | BUNKER | Approve/reject | ☐ |
| __________________________ | Cashier | BUNKER | As approved | ☐ |
| __________________________ | Kitchen operator | BUNKER | Kitchen only | ☐ |

**Account security:** Do not create placeholder accounts, share admin passwords, attach users by matching unverified emails, or automatically grant `super_admin`. Verify each real user's authentication identity and organization membership.

## Acceptance tests with branch hardware (do not create unapproved live transactions)

| Scenario | Expected result | Tester | Evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| Customer opens BUNKER QR | Correct branch only, all 15 products and descriptions | | | |
| Place order from authorized session | Request reaches BUNKER QR review inbox | | | |
| Reject a customer order | Correct status, no KDS ticket or sale | | | |
| Accept and route an order | Order reaches intended kitchen station | | | |
| Printer receipt | Correct branch, tax, items and payment method | | | |
| Complete order and close shift | Balances and audit trail are correct | | | |
| Refund/void | Authorized action leaves consistent stock and ledger | | | |
| Repeated submission | No duplicate live sale or kitchen ticket | | | |
| Offline then reconnect | Queued sales and stock reconcile exactly once | | | |
| Cross-branch cashier attempt | Access is denied and audit-tracked | | | |
| Backup restore rehearsal | Encrypted backup restores in isolated system | | | |

**Technical QA:** _____________________ **Kitchen supervisor:** _____________________  
**Branch owner authorization for live QR orders:** _____________________ **Date/time:** _____________________

## Domain project separation
The domain `bunker-egy.app` and `www.bunker-egy.app` are still bound to Premier OS on Vercel, though routing directs customers to the BUNKER website. A Vercel administrator must:
1. Remove both domains from Premier OS's **project association only** (not their DNS registration).
2. Add both to Vercel project **bunker**, set apex redirect to www, wait for verified HTTPS.
3. Open the root URL, try an unknown path, and verify no Premier login or admin route is exposed.
4. Check **ORDER NOW** points to the BUNKER QR token, not any other branch.

## Release control
- Live QR intake remains **disabled** and the preview is simulation only.
- A server-side trigger now refuses enabling BUNKER until products have non-zero recorded costs, a staff identity is authenticated and authorized, a warehouse is active, active tables exist and kitchen routes are valid.
- Passing this technical gate still requires owner sign-off on business prices, recipes, hardware, customer order journey and backup restore.
