'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PremierLocalEngine } = require('./engine.cjs');

/**
 * Premier OS — Phase B Local Engine End-to-End Acceptance Test
 * 
 * Verifies:
 * 1. Offline operation without WAN/Supabase.
 * 2. Opening cashier shift.
 * 3. Opening table.
 * 4. Adding order items.
 * 5. Negative test: Settle before KDS dispatch MUST FAIL (ORDER_NOT_FULLY_SENT).
 * 6. Dispatch items to local KDS.
 * 7. Query active kitchen orders.
 * 8. Settle order once via ACID transaction.
 * 9. Prove inventory movements deduction.
 * 10. Prove balanced double-entry accounting journal.
 * 11. Engine crash/restart simulation on persistent file database.
 * 12. Idempotency replay verification: No duplicate sales, movements, or journal entries.
 */
async function runAcceptanceTest() {
  console.log('===============================================================');
  console.log('PREMIER OS — WINDOWS LOCAL ENGINE PHASE B ACCEPTANCE TEST');
  console.log('===============================================================\n');

  const testDbFile = path.join(__dirname, 'test_premier_local.db');
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
    console.log('✔ Seeded branch, roles, cashier user, and warehouse.');

    // Seed initial inventory replenishment
    const item1Id = 'prod_burger_classic';
    const item2Id = 'prod_fresh_fries';
    engine.addStockEntry({ branchId, warehouseId, itemId: item1Id, quantity: 50, unitCost: 35.0 });
    engine.addStockEntry({ branchId, warehouseId, itemId: item2Id, quantity: 100, unitCost: 10.0 });

    const initialStockItem1 = engine.getInventoryBalance({ branchId, warehouseId, itemId: item1Id });
    assert.equal(initialStockItem1.balance, 50, 'Initial burger stock must be 50');
    console.log(`✔ Initial stock seeded: Burgers = ${initialStockItem1.balance}`);

    // 2. Open Cashier Shift
    console.log('\n[STEP 2] Opening Cashier Shift with 200.00 EGP float...');
    const shiftResult = engine.openShift({
      branchId,
      cashierId,
      openingFloat: 200.0,
    });
    assert.equal(shiftResult.success, true);
    const shiftId = shiftResult.shift.id;
    console.log(`✔ Shift opened successfully. Shift ID: ${shiftId}`);

    // 3. Open Table
    console.log('\n[STEP 3] Opening Table T-12...');
    const table = engine.createTable({ branchId, tableNumber: 'T-12', section: 'patio' });
    assert.equal(table.table_number, 'T-12');
    console.log(`✔ Table T-12 created/verified.`);

    const orderResult = engine.createOrder({
      branchId,
      tableId: table.id,
      shiftId,
      createdBy: cashierId,
      guestCount: 2,
    });
    assert.equal(orderResult.success, true);
    const orderId = orderResult.order.id;
    console.log(`✔ Order created. Order ID: ${orderId}, Order Number: ${orderResult.order.order_number}`);

    // Verify table is occupied
    const occupiedTable = engine.db.prepare('SELECT status, active_order_id FROM local_tables WHERE id = ?').get(table.id);
    assert.equal(occupiedTable.status, 'occupied');
    assert.equal(occupiedTable.active_order_id, orderId);
    console.log('✔ Table status marked as occupied with active order link.');

    // 4. Add 2 items to the order
    console.log('\n[STEP 4] Adding 2 items to the order...');
    engine.addOrderItem({
      orderId,
      productId: item1Id,
      productName: 'Classic Cheeseburger',
      quantity: 2,
      unitPrice: 85.0,
      stationCode: 'hot_kitchen',
      notes: 'Well done, no pickles',
    });

    engine.addOrderItem({
      orderId,
      productId: item2Id,
      productName: 'Fresh Crispy Fries',
      quantity: 1,
      unitPrice: 30.0,
      stationCode: 'fryer_station',
      notes: 'Extra salt',
    });

    const orderWithItems = engine.db.prepare('SELECT * FROM local_orders WHERE id = ?').get(orderId);
    assert.equal(orderWithItems.subtotal, 200.0); // (2 * 85) + (1 * 30) = 170 + 30 = 200
    assert.equal(orderWithItems.total_amount, 200.0);
    console.log(`✔ Items added. Order Subtotal: ${orderWithItems.subtotal} EGP.`);

    // 5. Negative Test: Attempt settlement before sending items to kitchen
    console.log('\n[STEP 5] Negative Test: Attempt settlement before sending to kitchen...');
    const testIdempotencyKey = `idem_${Date.now()}_test_01`;
    let preventedBeforeKitchen = false;
    try {
      engine.settleOrder({
        orderId,
        branchId,
        shiftId,
        cashierId,
        warehouseId,
        paymentMethod: 'cash',
        amount: 200.0,
        idempotencyKey: testIdempotencyKey,
      });
    } catch (err) {
      if (err.message.includes('ORDER_NOT_FULLY_SENT')) {
        preventedBeforeKitchen = true;
      }
    }
    assert.equal(preventedBeforeKitchen, true, 'Settlement MUST FAIL if items are not sent to kitchen!');
    console.log('✔ PASS: Engine safely blocked premature settlement (ORDER_NOT_FULLY_SENT).');

    // 6. Send Items to Kitchen
    console.log('\n[STEP 6] Dispatching order items to KDS...');
    const kitchenDispatch = engine.sendOrderToKitchen({ orderId, sentBy: cashierId });
    assert.equal(kitchenDispatch.success, true);
    assert.equal(kitchenDispatch.dispatchedCount, 2);
    console.log(`✔ Dispatched ${kitchenDispatch.dispatchedCount} items to kitchen stations.`);

    // 7. Query Local KDS
    console.log('\n[STEP 7] Querying active local KDS orders...');
    const kdsItems = engine.getKitchenOrders({ branchId });
    assert.equal(kdsItems.length, 2);
    assert.equal(kdsItems[0].order_id, orderId);
    console.log(`✔ Found ${kdsItems.length} active items on kitchen display:`);
    for (const item of kdsItems) {
      console.log(`   - Station: [${item.station_code}] Product: ${item.product_name} (Qty: ${item.sent_quantity})`);
    }

    // 8. Settle Order via Atomic Transaction
    console.log('\n[STEP 8] Settling order (Payment: 200.00 EGP Cash)...');
    const settleResult = engine.settleOrder({
      orderId,
      branchId,
      shiftId,
      cashierId,
      warehouseId,
      paymentMethod: 'cash',
      amount: 200.0,
      idempotencyKey: testIdempotencyKey,
      soldItemsCost: 80.0, // 2 burgers @ 35 = 70 + 1 fries @ 10 = 10 -> Total COGS 80
    });
    assert.equal(settleResult.success, true);
    assert.ok(settleResult.saleId);
    assert.ok(settleResult.invoiceNumber);
    console.log(`✔ Order settled successfully. Invoice Number: ${settleResult.invoiceNumber}`);

    // Verify order completed and table released
    const completedOrder = engine.db.prepare('SELECT status FROM local_orders WHERE id = ?').get(orderId);
    assert.equal(completedOrder.status, 'completed');
    const freedTable = engine.db.prepare('SELECT status, active_order_id FROM local_tables WHERE id = ?').get(table.id);
    assert.equal(freedTable.status, 'available');
    assert.equal(freedTable.active_order_id, null);
    console.log('✔ Order marked completed and Table T-12 released to available.');

    // 9. Prove Inventory Deduction
    console.log('\n[STEP 9] Verifying inventory deduction...');
    const burgerStockAfter = engine.getInventoryBalance({ branchId, warehouseId, itemId: item1Id });
    const friesStockAfter = engine.getInventoryBalance({ branchId, warehouseId, itemId: item2Id });

    assert.equal(burgerStockAfter.balance, 48, 'Burger stock must be 50 - 2 = 48');
    assert.equal(friesStockAfter.balance, 99, 'Fries stock must be 100 - 1 = 99');
    console.log(`✔ Burger balance: 48 (Deducted 2)`);
    console.log(`✔ Fries balance: 99 (Deducted 1)`);

    // 10. Prove Balanced Double-Entry Journal
    console.log('\n[STEP 10] Verifying double-entry journal balance...');
    const journalEntry = engine.db.prepare(
      `SELECT * FROM local_journal_entries WHERE reference_id = ?`
    ).get(settleResult.saleId);

    assert.ok(journalEntry, 'Journal entry must exist');
    assert.equal(journalEntry.is_balanced, 1, 'Journal entry must be marked balanced');
    assert.equal(journalEntry.total_debit, journalEntry.total_credit, 'Total Debit must equal Total Credit');

    const lines = engine.db.prepare(
      `SELECT * FROM local_journal_lines WHERE journal_entry_id = ?`
    ).all(journalEntry.id);

    let sumDebit = 0;
    let sumCredit = 0;
    console.log(`✔ Journal Entry #${journalEntry.entry_number}:`);
    for (const line of lines) {
      sumDebit += line.debit;
      sumCredit += line.credit;
      console.log(`   [${line.account_code}] ${line.account_name.padEnd(35)} | DR: ${line.debit.toFixed(2).padStart(8)} | CR: ${line.credit.toFixed(2).padStart(8)}`);
    }

    assert.equal(sumDebit.toFixed(4), sumCredit.toFixed(4), 'Sum of Debits must strictly equal sum of Credits');
    console.log(`✔ Verified Journal Balance: Total Debit = ${sumDebit.toFixed(2)} EGP, Total Credit = ${sumCredit.toFixed(2)} EGP.`);

    // Verify Outbox entry
    const outboxRow = engine.db.prepare(
      `SELECT * FROM local_outbox WHERE entity_id = ?`
    ).get(settleResult.saleId);
    assert.ok(outboxRow, 'Outbox row must be recorded for cloud sync');
    assert.equal(outboxRow.status, 'pending');
    console.log(`✔ Outbox record created for asynchronous cloud synchronization.`);

    // 11. Simulate Engine Restart (Crash / Windows Reboot)
    console.log('\n[STEP 11] Simulating Windows reboot: Closing engine and reopening database file...');
    engine.close();

    // Reopen from disk file
    engine = new PremierLocalEngine(testDbFile);
    console.log('✔ Database reopened from disk file.');

    const persistedSale = engine.db.prepare('SELECT * FROM local_sales WHERE id = ?').get(settleResult.saleId);
    assert.ok(persistedSale, 'Sale record must persist across restarts');
    assert.equal(persistedSale.total_amount, 200.0);

    const persistedBurgerStock = engine.getInventoryBalance({ branchId, warehouseId, itemId: item1Id });
    assert.equal(persistedBurgerStock.balance, 48, 'Stock must persist across restarts');
    console.log('✔ PASS: All data intact after simulated restart.');

    // 12. Idempotency Replay Test: Resend settlement with same idempotency key
    console.log('\n[STEP 12] Replay Test: Resending settlement with identical Idempotency Key...');
    const salesCountBefore = engine.db.prepare('SELECT count(*) as count FROM local_sales').get().count;
    const movementsCountBefore = engine.db.prepare('SELECT count(*) as count FROM local_inventory_movements').get().count;
    const journalCountBefore = engine.db.prepare('SELECT count(*) as count FROM local_journal_entries').get().count;

    const replayResult = engine.settleOrder({
      orderId,
      branchId,
      shiftId,
      cashierId,
      warehouseId,
      paymentMethod: 'cash',
      amount: 200.0,
      idempotencyKey: testIdempotencyKey,
      soldItemsCost: 80.0,
    });

    assert.equal(replayResult.isIdempotentReplay, true, 'Result must be flagged as idempotent replay');
    assert.equal(replayResult.saleId, settleResult.saleId);

    const salesCountAfter = engine.db.prepare('SELECT count(*) as count FROM local_sales').get().count;
    const movementsCountAfter = engine.db.prepare('SELECT count(*) as count FROM local_inventory_movements').get().count;
    const journalCountAfter = engine.db.prepare('SELECT count(*) as count FROM local_journal_entries').get().count;

    assert.equal(salesCountAfter, salesCountBefore, 'No new sale records allowed on replay');
    assert.equal(movementsCountAfter, movementsCountBefore, 'No duplicate inventory movements allowed on replay');
    assert.equal(journalCountAfter, journalCountBefore, 'No duplicate journal entries allowed on replay');

    console.log('✔ PASS: Idempotency strictly guarded against duplicate sales, inventory drops, or ledger lines.');

    // Verify shift summary
    const shiftSummary = engine.getShiftSummary({ shiftId });
    assert.equal(shiftSummary.salesCount, 1);
    assert.equal(shiftSummary.totalSales, 200.0);
    assert.equal(shiftSummary.cashCollected, 200.0);
    assert.equal(shiftSummary.expectedCashInDrawer, 400.0); // 200 float + 200 cash sale
    console.log('\n✔ Shift Summary Verified:');
    console.log(`   - Opening Float: ${shiftSummary.openingFloat} EGP`);
    console.log(`   - Cash Collected: ${shiftSummary.cashCollected} EGP`);
    console.log(`   - Expected Cash in Drawer: ${shiftSummary.expectedCashInDrawer} EGP`);

    console.log('\n===============================================================');
    console.log('ALL PHASE B ACCEPTANCE TESTS PASSED ACCORDING TO SPECIFICATIONS');
    console.log('===============================================================');

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
