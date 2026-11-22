'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { initDatabase } = require('./schema.cjs');

/**
 * Premier OS — Windows Local Transactional Engine
 * Offline-first ACID execution engine running on Node 22 built-in SQLite.
 * Single source of truth inside restaurant branches without Cloud/WAN dependency.
 */
class PremierLocalEngine {
  /**
   * @param {string|DatabaseSync} [dbOrPath=':memory:'] Path to SQLite DB file or in-memory instance
   */
  constructor(dbOrPath = ':memory:') {
    if (typeof dbOrPath === 'string') {
      this.dbPath = dbOrPath;
      this.db = new DatabaseSync(dbOrPath);
    } else {
      this.dbPath = ':instance:';
      this.db = dbOrPath;
    }

    initDatabase(this.db);
  }

  /**
   * Close the underlying database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Execute an operation inside an immediate transaction.
   * Auto-commits on success or rolls back on any error.
   */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn(this.db);
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (rollbackErr) {
        // Suppress rollback error if already rolled back
      }
      throw err;
    }
  }

  /**
   * Seed baseline branch, roles, users, and warehouse for testing or initial branch initialization.
   */
  seedInitialData({
    branchId = crypto.randomUUID(),
    branchName = 'Main Branch',
    cashierId = crypto.randomUUID(),
    cashierUsername = 'cashier1',
    cashierName = 'Primary Cashier',
    warehouseId = crypto.randomUUID(),
    warehouseName = 'Main Kitchen Warehouse',
  } = {}) {
    return this.transaction(() => {
      // 1. Roles
      const insertRole = this.db.prepare(
        `INSERT OR IGNORE INTO local_roles (name, permissions, description) VALUES (?, ?, ?)`
      );
      insertRole.run('admin', JSON.stringify(['all']), 'Full Local Administrator');
      insertRole.run('cashier', JSON.stringify(['pos:order', 'pos:settle', 'pos:shift']), 'POS Cashier');
      insertRole.run('kitchen', JSON.stringify(['kds:view', 'kds:status']), 'Kitchen Staff');

      // 2. Branch
      this.db.prepare(
        `INSERT OR REPLACE INTO local_branches (id, name, code, is_active) VALUES (?, ?, ?, 1)`
      ).run(branchId, branchName, 'BR-01');

      // 3. User
      this.db.prepare(
        `INSERT OR REPLACE INTO local_users (id, username, full_name, pin_hash, role, branch_id, is_active)
         VALUES (?, ?, ?, ?, 'cashier', ?, 1)`
      ).run(cashierId, cashierUsername, cashierName, 'hash_placeholder', branchId);

      // 4. Warehouse
      this.db.prepare(
        `INSERT OR REPLACE INTO local_warehouses (id, branch_id, name, is_active)
         VALUES (?, ?, ?, 1)`
      ).run(warehouseId, branchId, warehouseName);

      return { branchId, cashierId, warehouseId };
    });
  }

  /**
   * Open a cashier shift.
   */
  openShift({ branchId, cashierId, openingFloat = 0.0 }) {
    if (!branchId || !cashierId) {
      throw new Error('BRANCH_OR_CASHIER_MISSING');
    }

    // Verify cashier exists and is active
    const user = this.db.prepare(
      `SELECT id, is_active, branch_id FROM local_users WHERE id = ?`
    ).get(cashierId);

    if (!user || !user.is_active || user.branch_id !== branchId) {
      throw new Error('INVALID_CASHIER');
    }

    // Check for open shift for this cashier
    const existingShift = this.db.prepare(
      `SELECT id FROM local_shifts WHERE cashier_id = ? AND branch_id = ? AND status = 'open'`
    ).get(cashierId, branchId);

    if (existingShift) {
      return {
        success: true,
        alreadyOpen: true,
        shift: this.db.prepare(`SELECT * FROM local_shifts WHERE id = ?`).get(existingShift.id),
      };
    }

    const shiftId = crypto.randomUUID();
    const openedAt = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO local_shifts (id, branch_id, cashier_id, status, opening_float, opened_at)
       VALUES (?, ?, ?, 'open', ?, ?)`
    ).run(shiftId, branchId, cashierId, openingFloat, openedAt);

    const shift = this.db.prepare(`SELECT * FROM local_shifts WHERE id = ?`).get(shiftId);
    return { success: true, shift };
  }

  /**
   * Create or open a table in the floor plan.
   */
  createTable({ branchId, tableNumber, section = 'main' }) {
    const tableId = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO local_tables (id, branch_id, table_number, section, status)
       VALUES (?, ?, ?, ?, 'available')
       ON CONFLICT(branch_id, table_number) DO UPDATE SET section = excluded.section`
    ).run(tableId, branchId, tableNumber, section);

    return this.db.prepare(
      `SELECT * FROM local_tables WHERE branch_id = ? AND table_number = ?`
    ).get(branchId, tableNumber);
  }

  /**
   * Create a new order (dining table or takeaway).
   */
  createOrder({ branchId, tableId = null, shiftId, createdBy, guestCount = 1 }) {
    if (!branchId || !createdBy || !shiftId) {
      throw new Error('ORDER_CREATION_PARAMETERS_MISSING');
    }

    return this.transaction(() => {
      // Validate shift is open
      const shift = this.db.prepare(
        `SELECT id, status FROM local_shifts WHERE id = ? AND branch_id = ?`
      ).get(shiftId, branchId);
      if (!shift || shift.status !== 'open') {
        throw new Error('SHIFT_NOT_OPEN');
      }

      // If table provided, check availability or existing active order
      if (tableId) {
        const table = this.db.prepare(
          `SELECT id, status, active_order_id FROM local_tables WHERE id = ? AND branch_id = ?`
        ).get(tableId, branchId);

        if (!table) {
          throw new Error('TABLE_NOT_FOUND');
        }
      }

      const orderId = crypto.randomUUID();
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const now = new Date().toISOString();

      this.db.prepare(
        `INSERT INTO local_orders (id, order_number, branch_id, table_id, shift_id, created_by, status, guest_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
      ).run(orderId, orderNumber, branchId, tableId, shiftId, createdBy, guestCount, now, now);

      if (tableId) {
        this.db.prepare(
          `UPDATE local_tables SET status = 'occupied', active_order_id = ? WHERE id = ?`
        ).run(orderId, tableId);
      }

      const order = this.db.prepare(`SELECT * FROM local_orders WHERE id = ?`).get(orderId);
      return { success: true, order };
    });
  }

  /**
   * Add an item to an active order.
   */
  addOrderItem({ orderId, productId, productName, quantity, unitPrice, stationCode = 'kitchen', notes = null }) {
    if (!orderId || !productId || !productName) {
      throw new Error('MISSING_ORDER_ITEM_DATA');
    }
    if (quantity <= 0) {
      throw new Error('INVALID_QUANTITY: Must be greater than 0');
    }
    if (unitPrice < 0) {
      throw new Error('INVALID_UNIT_PRICE: Must be non-negative');
    }

    return this.transaction(() => {
      const order = this.db.prepare(`SELECT id, status FROM local_orders WHERE id = ?`).get(orderId);
      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }
      if (order.status === 'completed' || order.status === 'cancelled') {
        throw new Error(`ORDER_CLOSED: Cannot add item to ${order.status} order`);
      }

      const itemId = crypto.randomUUID();
      const totalPrice = quantity * unitPrice;

      this.db.prepare(
        `INSERT INTO local_order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price, station_code, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(itemId, orderId, productId, productName, quantity, unitPrice, totalPrice, stationCode, notes);

      // Recalculate order totals
      const totals = this.db.prepare(
        `SELECT SUM(total_price) as subtotal FROM local_order_items WHERE order_id = ?`
      ).get(orderId);

      const subtotal = totals.subtotal || 0.0;
      const totalAmount = subtotal; // can apply discount/tax rules if needed

      this.db.prepare(
        `UPDATE local_orders SET subtotal = ?, total_amount = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(subtotal, totalAmount, orderId);

      const item = this.db.prepare(`SELECT * FROM local_order_items WHERE id = ?`).get(itemId);
      const updatedOrder = this.db.prepare(`SELECT * FROM local_orders WHERE id = ?`).get(orderId);

      return { success: true, item, order: updatedOrder };
    });
  }

  /**
   * Send pending unsent items of an order to the Kitchen (KDS).
   */
  sendOrderToKitchen({ orderId, sentBy }) {
    if (!orderId || !sentBy) {
      throw new Error('MISSING_SEND_PARAMETERS');
    }

    return this.transaction(() => {
      const order = this.db.prepare(`SELECT id, status, branch_id FROM local_orders WHERE id = ?`).get(orderId);
      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }
      if (order.status === 'completed' || order.status === 'cancelled') {
        throw new Error(`ORDER_CLOSED: Cannot send items for ${order.status} order`);
      }

      // Fetch items that have unsent quantities
      const itemsToDispatch = this.db.prepare(
        `SELECT id, station_code, quantity, sent_quantity
         FROM local_order_items
         WHERE order_id = ? AND sent_quantity < quantity`
      ).all(orderId);

      if (itemsToDispatch.length === 0) {
        return {
          success: true,
          dispatchedCount: 0,
          message: 'NO_NEW_ITEMS_TO_SEND',
        };
      }

      const now = new Date().toISOString();
      const sends = [];

      for (const item of itemsToDispatch) {
        const unsentQty = item.quantity - item.sent_quantity;
        const sendId = crypto.randomUUID();

        this.db.prepare(
          `INSERT INTO local_kitchen_sends (id, order_id, order_item_id, station_code, sent_quantity, status, sent_by, sent_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).run(sendId, orderId, item.id, item.station_code, unsentQty, sentBy, now);

        this.db.prepare(
          `UPDATE local_order_items SET sent_quantity = quantity WHERE id = ?`
        ).run(item.id);

        sends.push({ sendId, itemId: item.id, sentQuantity: unsentQty, stationCode: item.station_code });
      }

      this.db.prepare(
        `UPDATE local_orders SET status = 'sent_to_kitchen', updated_at = ? WHERE id = ?`
      ).run(now, orderId);

      return {
        success: true,
        dispatchedCount: sends.length,
        sends,
        orderStatus: 'sent_to_kitchen',
      };
    });
  }

  /**
   * Retrieve active KDS orders for a station.
   */
  getKitchenOrders({ branchId, stationCode = null }) {
    let sql = `
      SELECT 
        ks.id as send_id,
        ks.order_id,
        ks.station_code,
        ks.sent_quantity,
        ks.status as send_status,
        ks.sent_at,
        oi.product_name,
        oi.notes,
        o.order_number,
        o.table_id,
        t.table_number,
        u.full_name as sent_by_name
      FROM local_kitchen_sends ks
      JOIN local_order_items oi ON oi.id = ks.order_item_id
      JOIN local_orders o ON o.id = ks.order_id
      LEFT JOIN local_tables t ON t.id = o.table_id
      LEFT JOIN local_users u ON u.id = ks.sent_by
      WHERE o.branch_id = ? AND ks.status IN ('pending', 'in_progress')
    `;
    const params = [branchId];

    if (stationCode) {
      sql += ` AND ks.station_code = ?`;
      params.push(stationCode);
    }

    sql += ` ORDER BY ks.sent_at ASC`;

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Settle an order, record the sale, collect payment, deduct stock,
   * generate double-entry journal, and write outbox for cloud sync.
   * Fully idempotent using idempotencyKey.
   */
  settleOrder({
    orderId,
    branchId,
    shiftId,
    cashierId,
    warehouseId,
    paymentMethod = 'cash',
    amount,
    idempotencyKey,
    soldItemsCost = 0.0,
  }) {
    if (!orderId || !branchId || !cashierId || !idempotencyKey) {
      throw new Error('SETTLEMENT_PARAMETERS_MISSING');
    }

    // 1. Check idempotency key first (outside transaction lock)
    const existingRecord = this.db.prepare(
      `SELECT response_payload FROM local_idempotency_keys WHERE key = ?`
    ).get(idempotencyKey);

    if (existingRecord) {
      const parsed = JSON.parse(existingRecord.response_payload);
      return {
        ...parsed,
        isIdempotentReplay: true,
      };
    }

    // 2. Perform ACID atomic settlement
    return this.transaction(() => {
      // Re-check idempotency under transaction
      const doubleCheck = this.db.prepare(
        `SELECT response_payload FROM local_idempotency_keys WHERE key = ?`
      ).get(idempotencyKey);
      if (doubleCheck) {
        return {
          ...JSON.parse(doubleCheck.response_payload),
          isIdempotentReplay: true,
        };
      }

      // Check order
      const order = this.db.prepare(`SELECT * FROM local_orders WHERE id = ?`).get(orderId);
      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }
      if (order.status === 'completed') {
        throw new Error('ORDER_ALREADY_COMPLETED');
      }
      if (order.status === 'cancelled') {
        throw new Error('ORDER_CANCELLED');
      }

      // Safety Rule: Order must be fully sent to kitchen before settlement
      const unsentCheck = this.db.prepare(
        `SELECT count(*) as count FROM local_order_items WHERE order_id = ? AND sent_quantity < quantity`
      ).get(orderId);

      if (unsentCheck && unsentCheck.count > 0) {
        throw new Error('ORDER_NOT_FULLY_SENT: Cannot settle an order with items unsent to kitchen');
      }

      // Safety Rule: Payment amount must cover total_amount
      if (amount < order.total_amount) {
        throw new Error(`INVALID_PAYMENT_AMOUNT: Amount ${amount} is less than total ${order.total_amount}`);
      }

      const saleId = crypto.randomUUID();
      const paymentId = crypto.randomUUID();
      const invoiceNumber = `INV-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const now = new Date().toISOString();

      // Insert Sale
      this.db.prepare(
        `INSERT INTO local_sales (id, order_id, invoice_number, branch_id, shift_id, cashier_id, subtotal, discount_amount, tax_amount, total_amount, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        saleId,
        orderId,
        invoiceNumber,
        branchId,
        shiftId || order.shift_id,
        cashierId,
        order.subtotal,
        order.discount_amount,
        order.tax_amount,
        order.total_amount,
        idempotencyKey,
        now
      );

      // Insert Payment
      this.db.prepare(
        `INSERT INTO local_payments (id, sale_id, payment_method, amount, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(paymentId, saleId, paymentMethod, amount, now);

      // Update Order to Completed
      this.db.prepare(
        `UPDATE local_orders SET status = 'completed', updated_at = ? WHERE id = ?`
      ).run(now, orderId);

      // Release Table if assigned
      if (order.table_id) {
        this.db.prepare(
          `UPDATE local_tables SET status = 'available', active_order_id = NULL WHERE id = ?`
        ).run(order.table_id);
      }

      // Deduct Inventory Movements for each order item
      const orderItems = this.db.prepare(
        `SELECT id, product_id, product_name, quantity, unit_price, total_price FROM local_order_items WHERE order_id = ?`
      ).all(orderId);

      const inventoryMovements = [];
      for (const item of orderItems) {
        const movementId = crypto.randomUUID();
        const delta = -item.quantity;
        // Cost estimation per unit
        const unitCost = (soldItemsCost > 0 && order.total_amount > 0)
          ? ((soldItemsCost / order.total_amount) * item.unit_price)
          : 0.0;
        const totalCost = unitCost * item.quantity;

        this.db.prepare(
          `INSERT INTO local_inventory_movements (id, branch_id, warehouse_id, item_type, item_id, delta, unit_cost, total_cost, entry_type, reference_id, created_at)
           VALUES (?, ?, ?, 'product', ?, ?, ?, ?, 'sale', ?, ?)`
        ).run(movementId, branchId, warehouseId, item.product_id, delta, unitCost, totalCost, saleId, now);

        inventoryMovements.push({ movementId, itemId: item.product_id, delta });
      }

      // Generate Balanced Double-Entry Journal
      const journalEntryId = crypto.randomUUID();
      const entryNumber = `JE-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

      // Debits: Cash/Receivables = total_amount.
      // If soldItemsCost > 0: Debit COGS = soldItemsCost
      // Credits: Sales Revenue = total_amount.
      // If soldItemsCost > 0: Credit Food Inventory = soldItemsCost
      const totalDebit = order.total_amount + (soldItemsCost > 0 ? soldItemsCost : 0.0);
      const totalCredit = order.total_amount + (soldItemsCost > 0 ? soldItemsCost : 0.0);

      this.db.prepare(
        `INSERT INTO local_journal_entries (id, branch_id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, is_balanced, created_at)
         VALUES (?, ?, ?, date(?), 'sale', ?, ?, ?, ?, 1, ?)`
      ).run(
        journalEntryId,
        branchId,
        entryNumber,
        now,
        saleId,
        `POS Sale Invoice ${invoiceNumber}`,
        totalDebit,
        totalCredit,
        now
      );

      // Debit Cash (or Bank/Card)
      const cashAccountId = paymentMethod === 'cash' ? '1010' : '1020';
      const cashAccountName = paymentMethod === 'cash' ? 'Cash on Hand (POS Drawer)' : 'Card Payment Clearing';
      this.db.prepare(
        `INSERT INTO local_journal_lines (id, journal_entry_id, account_code, account_name, debit, credit)
         VALUES (?, ?, ?, ?, ?, 0.0)`
      ).run(crypto.randomUUID(), journalEntryId, cashAccountId, cashAccountName, order.total_amount);

      // Credit Revenue
      this.db.prepare(
        `INSERT INTO local_journal_lines (id, journal_entry_id, account_code, account_name, debit, credit)
         VALUES (?, ?, '4010', 'Restaurant Sales Revenue', 0.0, ?)`
      ).run(crypto.randomUUID(), journalEntryId, order.total_amount);

      // Cost of Goods Sold & Inventory Ledger (if cost available)
      if (soldItemsCost > 0) {
        // Debit COGS
        this.db.prepare(
          `INSERT INTO local_journal_lines (id, journal_entry_id, account_code, account_name, debit, credit)
           VALUES (?, ?, '5010', 'Cost of Goods Sold (Food Cost)', ?, 0.0)`
        ).run(crypto.randomUUID(), journalEntryId, soldItemsCost);

        // Credit Inventory Asset
        this.db.prepare(
          `INSERT INTO local_journal_lines (id, journal_entry_id, account_code, account_name, debit, credit)
           VALUES (?, ?, '1210', 'Food & Beverage Inventory', 0.0, ?)`
        ).run(crypto.randomUUID(), journalEntryId, soldItemsCost);
      }

      // Add to Cloud Outbox for durable sync
      const outboxId = crypto.randomUUID();
      this.db.prepare(
        `INSERT INTO local_outbox (id, branch_id, entity_type, entity_id, action, payload, status, created_at)
         VALUES (?, ?, 'sale', ?, 'create', ?, 'pending', ?)`
      ).run(
        outboxId,
        branchId,
        saleId,
        JSON.stringify({
          saleId,
          orderId,
          invoiceNumber,
          totalAmount: order.total_amount,
          paymentMethod,
          itemsCount: orderItems.length,
        }),
        now
      );

      const responsePayload = {
        success: true,
        saleId,
        invoiceNumber,
        orderId,
        totalAmount: order.total_amount,
        paymentMethod,
        journalEntryId,
        entryNumber,
        movementsCount: inventoryMovements.length,
      };

      // Record Idempotency Key
      this.db.prepare(
        `INSERT INTO local_idempotency_keys (key, operation_type, resource_id, response_payload, created_at)
         VALUES (?, 'settleOrder', ?, ?, ?)`
      ).run(idempotencyKey, saleId, JSON.stringify(responsePayload), now);

      return responsePayload;
    });
  }

  /**
   * Get real-time stock balance for an item in a specific warehouse.
   */
  getInventoryBalance({ branchId, warehouseId, itemId }) {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(delta), 0.0) as balance
       FROM local_inventory_movements
       WHERE branch_id = ? AND warehouse_id = ? AND item_id = ?`
    ).get(branchId, warehouseId, itemId);

    return {
      branchId,
      warehouseId,
      itemId,
      balance: row ? row.balance : 0.0,
    };
  }

  /**
   * Add initial stock replenishment / purchase to test inventory levels.
   */
  addStockEntry({ branchId, warehouseId, itemId, quantity, unitCost = 0.0, entryType = 'purchase', referenceId = null }) {
    if (quantity <= 0) {
      throw new Error('INVALID_QUANTITY');
    }

    const movementId = crypto.randomUUID();
    const totalCost = quantity * unitCost;

    this.db.prepare(
      `INSERT INTO local_inventory_movements (id, branch_id, warehouse_id, item_type, item_id, delta, unit_cost, total_cost, entry_type, reference_id)
       VALUES (?, ?, ?, 'product', ?, ?, ?, ?, ?, ?)`
    ).run(movementId, branchId, warehouseId, itemId, quantity, unitCost, totalCost, entryType, referenceId);

    return this.getInventoryBalance({ branchId, warehouseId, itemId });
  }

  /**
   * Summarize cashier shift performance and cash balance.
   */
  getShiftSummary({ shiftId }) {
    const shift = this.db.prepare(`SELECT * FROM local_shifts WHERE id = ?`).get(shiftId);
    if (!shift) {
      throw new Error('SHIFT_NOT_FOUND');
    }

    const salesStats = this.db.prepare(
      `SELECT 
        COUNT(s.id) as sales_count,
        COALESCE(SUM(s.total_amount), 0.0) as total_sales,
        COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.amount ELSE 0.0 END), 0.0) as cash_collected,
        COALESCE(SUM(CASE WHEN p.payment_method = 'card' THEN p.amount ELSE 0.0 END), 0.0) as card_collected
       FROM local_sales s
       LEFT JOIN local_payments p ON p.sale_id = s.id
       WHERE s.shift_id = ?`
    ).get(shiftId);

    return {
      shiftId: shift.id,
      status: shift.status,
      cashierId: shift.cashier_id,
      openingFloat: shift.opening_float,
      openedAt: shift.opened_at,
      closedAt: shift.closed_at,
      salesCount: salesStats.sales_count,
      totalSales: salesStats.total_sales,
      cashCollected: salesStats.cash_collected,
      cardCollected: salesStats.card_collected,
      expectedCashInDrawer: shift.opening_float + salesStats.cash_collected,
    };
  }
}

module.exports = {
  PremierLocalEngine,
};
