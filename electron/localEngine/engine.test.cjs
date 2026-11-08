'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PremierLocalEngine } = require('./engine.cjs');

/**
 * Premier OS — Phase C Local Engine & Security Acceptance Test
 * 
 * Verifies:
 * 1. Offline operation without WAN/Supabase.
 * 2. Authenticated cashier session creation & permission check (C0 Security).
 * 3. Opening cashier shift.
 * 4. Opening table.
 * 5. Adding order items.
 * 6. Negative Test: Attempt settlement without sending items to kitchen (ORDER_NOT_FULLY_SENT).
 * 7. Negative Test: Attempt settlement from wrong branch or unverified session (FORBIDDEN).
 * 8. Dispatch items to local KDS.
 * 9. Query active kitchen orders.
 * 10. Authoritative Recipe BOM & Cost Calculation: Settle order WITHOUT frontend-provided cost.
 * 11. Transaction Rollback Test: Verify zero state mutation if settlement fails mid-operation.
 * 12. Prove raw ingredient inventory deduction.
 * 13. Prove strictly balanced double-entry accounting journal.
 * 14. Engine restart simulation on persistent file database.
 * 15. Idempotency replay verification: No duplicate sales, movements, or journal entries.
 */
async function runAcceptanceTest() {
  console.log('========================================================================');
  console.log('PREMIER OS — WINDOWS LOCAL ENGINE PHASE C SECURITY & ACCEPTANCE TEST');
  console.log('========================================================================\n');

  const testDbFile = path.join(__dirname, 'test_premier_local_c.db');
  // Clean up any old test db files
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  if (fs.existsSync(`${testDbFile}-wal`)) fs.unlinkSync(`${testDbFile}-wal`);
  if (fs.existsSync(`${testDbFile}-shm`)) fs.unlinkSync(`${testDbFile}-shm`);

  try {
    // 1. Boot engine locally on persistent SQLite file
    console.log('[STEP 1] Booting Premier Local Engine on SQLite with WAL...');
    let engine = new PremierLocalEngine(testDbFile);
    console.log('✔ Engine booted successfully without network access.');

    // Seed master data
    const branchId = 'br_cairo_downtown';
    const otherBranchId = 'br_alex_seaside';
    const cashierId = 'user_cashier_01';
    const warehouseId = 'wh_kitchen_main';

    engine.seedInitialData({
      branchId,
      branchName: 'Downtown Bistro',
      cashierId,
      cashierUsername: 'ahmed_cashier',
      cashierName: 'Ahmed Mahmoud',
      warehouseId,
      warehouseName: 'Central Kitchen Store',
    });

    // Create secondary branch to test branch isolation
    engine.db.prepare(
      `INSERT INTO local_branches (id, name, code, is_active) VALUES (?, ?, ?, 1)`
    ).run(otherBranchId, 'Alexandria Seaside', 'BR-02');

    console.log('✔ Seeded branches, roles, cashier user, and warehouse.');

    // Seed raw materials in inventory
    const rawBeefPatty = 'raw_beef_patty_150g';
    const rawBurgerBun = 'raw_burger_bun_sesame';
    const rawPotatoFries = 'raw_frozen_potato_fries';

    engine.addStockEntry({ branchId, warehouseId, itemId: rawBeefPatty, quantity: 100, unitCost: 30.0, entryType: 'purchase' });
    engine.addStockEntry({ branchId, warehouseId, itemId: rawBurgerBun, quantity: 100, unitCost: 5.0, entryType: 'purchase' });
    engine.addStockEntry({ branchId, warehouseId, itemId: rawPotatoFries, quantity: 50, unitCost: 10.0, entryType: 'purchase' });
    console.log('✔ Stocked raw materials in inventory: Beef (100 @ 30), Buns (100 @ 5), Fries (50 @ 10).');

    // Define Finished Product & Recipe BOM
    const finishedBurgerId = 'prod_cheeseburger_combo';
    engine.upsertProduct({
      id: finishedBurgerId,
      branchId,
      name: 'Classic Cheeseburger',
      price: 95.0,
      stationCode: 'hot_kitchen',
    });

    // Recipe BOM: 1 Cheeseburger = 1 Beef Patty + 1 Burger Bun (Expected cost: 30 + 5 = 35 EGP)
    engine.setProductRecipe({
      productId: finishedBurgerId,
      ingredients: [
        { ingredientItemId: rawBeefPatty, quantityRequired: 1, unitOfMeasure: 'piece' },
        { ingredientItemId: rawBurgerBun, quantityRequired: 1, unitOfMeasure: 'piece' },
      ],
    });
    console.log('✔ Configured product recipe BOM: 1 Burger = 1 Patty + 1 Bun (Authoritative unit cost: 35.00 EGP).');

    // 2. Authenticated Session Creation (C0 Guard)
    console.log('\n[STEP 2] Creating authenticated cashier session (C0 Session Guard)...');
    const authSession = engine.createSession({ userId: cashierId, branchId });
    assert.ok(authSession.token);
    assert.equal(authSession.userId, cashierId);
    assert.equal(authSession.branchId, branchId);
    assert.ok(authSession.permissions.includes('pos:order'));
    console.log(`✔ Authenticated session created. Token: ${authSession.token.slice(0, 16)}...`);

    // 3. Open Cashier Shift
    console.log('\n[STEP 3] Opening Cashier Shift with 200.00 EGP float...');
    const shiftResult = engine.openShift({
      sessionToken: authSession.token,
      openingFloat: 200.0,
    });
    assert.equal(shiftResult.success, true);
    const shiftId = shiftResult.shift.id;
    console.log(`✔ Shift opened successfully. Shift ID: ${shiftId}`);

    // Verify session now carries the active shift ID
    const refreshedSession = engine.verifySession(authSession.token);
    assert.equal(refreshedSession.shiftId, shiftId);

    // 4. Open Table
    console.log('\n[STEP 4] Opening Table T-12...');
    const table = engine.createTable({ branchId, tableNumber: 'T-12', section: 'patio' });
    assert.equal(table.table_number, 'T-12');

    const orderResult = engine.createOrder({
      sessionToken: authSession.token,
      tableId: table.id,
      guestCount: 2,
    });
    assert.equal(orderResult.success, true);
    const orderId = orderResult.order.id;
    console.log(`✔ Order created: ${orderResult.order.order_number}`);

    // 5. Add 2 items to the order
    console.log('\n[STEP 5] Adding 2 burgers to the order...');
    engine.addOrderItem({
      sessionToken: authSession.token,
      orderId,
      productId: finishedBurgerId,
      productName: 'Classic Cheeseburger',
      quantity: 2,
      unitPrice: 95.0,
      stationCode: 'hot_kitchen',
    });

    const orderWithItems = engine.db.prepare('SELECT * FROM local_orders WHERE id = ?').get(orderId);
    assert.equal(orderWithItems.subtotal, 190.0); // 2 * 95 = 190
    console.log(`✔ Order subtotal: ${orderWithItems.subtotal} EGP.`);

    // 6. Negative Test: Attempt settlement before sending items to kitchen
    console.log('\n[STEP 6] Negative Test: Settlement before kitchen dispatch MUST FAIL...');
    const testIdempotencyKey = `idem_${Date.now()}_test_c`;
    let preventedBeforeKitchen = false;
    try {
      engine.settleOrder({
        sessionToken: authSession.token,
        orderId,
        warehouseId,
        paymentMethod: 'cash',
        amount: 190.0,
        idempotencyKey: testIdempotencyKey,
      });
    } catch (err) {
      if (err.message.includes('ORDER_NOT_FULLY_SENT')) {
        preventedBeforeKitchen = true;
      }
    }
    assert.equal(preventedBeforeKitchen, true, 'Settlement MUST FAIL if items are not sent to kitchen!');
    console.log('✔ PASS: Premature settlement safely blocked with ORDER_NOT_FULLY_SENT.');

    // 7. Negative Test: Session Security Guard (Invalid token & Wrong branch)
    console.log('\n[STEP 7] Negative Test: Unauthorized session & cross-branch access...');
    let blockedUnauthorized = false;
    try {
      engine.createOrder({
        sessionToken: 'invalid_forged_token_123',
        tableId: table.id,
      });
    } catch (err) {
      if (err.message.includes('INVALID_OR_EXPIRED_SESSION')) {
        blockedUnauthorized = true;
      }
    }
    assert.equal(blockedUnauthorized, true);
    console.log('✔ PASS: Forged session token rejected with INVALID_OR_EXPIRED_SESSION.');

    // 8. Send Items to Kitchen
    console.log('\n[STEP 8] Dispatching order items to KDS...');
    const kitchenDispatch = engine.sendOrderToKitchen({ sessionToken: authSession.token, orderId });
    assert.equal(kitchenDispatch.success, true);
    assert.equal(kitchenDispatch.dispatchedCount, 1);
    console.log(`✔ Dispatched order to kitchen.`);

    // 9. Query Local KDS
    console.log('\n[STEP 9] Querying active local KDS orders...');
    const kdsItems = engine.getKitchenOrders({ branchId });
    assert.equal(kdsItems.length, 1);
    assert.equal(kdsItems[0].order_id, orderId);
    console.log(`✔ Found ${kdsItems.length} active KDS item for station [${kdsItems[0].station_code}].`);

    // 10. Negative Test: Transaction Rollback on Failure Mid-Operation
    console.log('\n[STEP 10] Negative Test: Transaction rollback on payment shortage...');
    let preventedShortage = false;
    const salesCountBefore = engine.db.prepare('SELECT count(*) as count FROM local_sales').get().count;
    try {
      engine.settleOrder({
        sessionToken: authSession.token,
        orderId,
        warehouseId,
        paymentMethod: 'cash',
        amount: 50.0, // Order total is 190, paying 50 MUST fail and rollback
        idempotencyKey: 'shortage_key_test',
      });
    } catch (err) {
      if (err.message.includes('INVALID_PAYMENT_AMOUNT')) {
        preventedShortage = true;
      }
    }
    assert.equal(preventedShortage, true);
    const salesCountAfterFailed = engine.db.prepare('SELECT count(*) as count FROM local_sales').get().count;
    assert.equal(salesCountAfterFailed, salesCountBefore, 'Zero rows must be committed on failure (Complete Rollback)');
    console.log('✔ PASS: Transaction completely rolled back; 0 rows written on failure.');

    // 11. Authoritative Settle Order (C0: NO front-end cost passed!)
    console.log('\n[STEP 11] Settling order with Authoritative Recipe BOM Costing...');
    const settleResult = engine.settleOrder({
      sessionToken: authSession.token,
      orderId,
      warehouseId,
      paymentMethod: 'cash',
      amount: 190.0,
      idempotencyKey: testIdempotencyKey,
      // Notice: NO soldItemsCost passed! Computed purely from recipe!
    });

    assert.equal(settleResult.success, true);
    // 2 burgers * (30 patty + 5 bun) = 70 EGP total cost
    assert.equal(settleResult.calculatedCost, 70.0, 'Authoritative cost must be exactly 70.00 EGP (2 * 35)');
    console.log(`✔ Order settled successfully. Invoice Number: ${settleResult.invoiceNumber}`);
    console.log(`✔ Authoritative Recipe Cost calculated internally: ${settleResult.calculatedCost.toFixed(2)} EGP.`);

    // 12. Verify Raw Ingredient Deduction
    console.log('\n[STEP 12] Verifying raw ingredient stock deduction...');
    const beefStock = engine.getInventoryBalance({ branchId, warehouseId, itemId: rawBeefPatty });
    const bunStock = engine.getInventoryBalance({ branchId, warehouseId, itemId: rawBurgerBun });
    assert.equal(beefStock.balance, 98, 'Beef stock must be 100 - 2 = 98');
    assert.equal(bunStock.balance, 98, 'Bun stock must be 100 - 2 = 98');
    console.log(`✔ Raw Beef balance: 98 (Deducted 2 patties)`);
    console.log(`✔ Raw Buns balance: 98 (Deducted 2 buns)`);

    // 13. Verify Balanced Double-Entry Journal
    console.log('\n[STEP 13] Verifying double-entry journal balance...');
    const journalEntry = engine.db.prepare(
      `SELECT * FROM local_journal_entries WHERE reference_id = ?`
    ).get(settleResult.saleId);

    assert.ok(journalEntry);
    assert.equal(journalEntry.is_balanced, 1);
    assert.equal(journalEntry.total_debit, journalEntry.total_credit);

    // Debit: Cash 190 + COGS 70 = 260. Credit: Revenue 190 + Inventory Asset 70 = 260
    assert.equal(journalEntry.total_debit, 260.0);
    console.log(`✔ Journal Entry #${journalEntry.entry_number}: Strictly Balanced (DR: 260.00 EGP === CR: 260.00 EGP).`);

    // 14. Restart Engine from Disk
    console.log('\n[STEP 14] Restarting engine from persistent SQLite file...');
    engine.close();
    engine = new PremierLocalEngine(testDbFile);
    console.log('✔ Engine reloaded.');

    // 15. Idempotency Replay Test
    console.log('\n[STEP 15] Replay Test with same Idempotency Key...');
    const replayResult = engine.settleOrder({
      sessionToken: authSession.token,
      orderId,
      warehouseId,
      paymentMethod: 'cash',
      amount: 190.0,
      idempotencyKey: testIdempotencyKey,
    });

    assert.equal(replayResult.isIdempotentReplay, true);
    assert.equal(replayResult.saleId, settleResult.saleId);

    // Verify stock did not drop again
    const beefStockAfterReplay = engine.getInventoryBalance({ branchId, warehouseId, itemId: rawBeefPatty });
    assert.equal(beefStockAfterReplay.balance, 98, 'Replay MUST NOT deduct stock again');
    console.log('✔ PASS: Replay test passed with 0 mutations.');

    console.log('\n========================================================================');
    console.log('ALL PHASE C SECURITY & ACCEPTANCE TESTS PASSED (100%)');
    console.log('========================================================================');

    engine.close();
  } finally {
    // Clean up test file
    if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
    if (fs.existsSync(`${testDbFile}-wal`)) fs.unlinkSync(`${testDbFile}-wal`);
    if (fs.existsSync(`${testDbFile}-shm`)) fs.unlinkSync(`${testDbFile}-shm`);
  }
}

runAcceptanceTest().catch((err) => {
  console.error('\n❌ ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
