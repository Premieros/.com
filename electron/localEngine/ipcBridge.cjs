'use strict';

const path = require('node:path');
const { PremierLocalEngine } = require('./engine.cjs');

/**
 * Connects the PremierLocalEngine to Electron's IPC bus.
 * Enforces C0 Security: Never trust client-provided IDs. All operations
 * must execute under a validated authenticated session managed by Main Process.
 */
function registerLocalEngineIPC(ipcMain, app) {
  const dbDir = app ? app.getPath('userData') : process.cwd();
  const dbPath = process.env.PREMIER_LOCAL_DB_PATH || path.join(dbDir, 'premier_local.db');

  const engine = new PremierLocalEngine(dbPath);

  // Authoritative Session State in Electron Main Process
  let activeSessionToken = null;

  /**
   * Helper to ensure active authenticated session exists.
   */
  function getVerifiedSession() {
    if (!activeSessionToken) {
      throw new Error('UNAUTHORIZED_SESSION: No cashier session authenticated');
    }
    return engine.verifySession(activeSessionToken);
  }

  // 1. Session Login
  ipcMain.handle('local-engine:login', async (_event, { userId, branchId }) => {
    try {
      const session = engine.createSession({ userId, branchId });
      activeSessionToken = session.token;
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 2. Open Cashier Shift
  ipcMain.handle('local-engine:open-shift', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const result = engine.openShift({
        sessionToken: session.token,
        openingFloat: Number(payload.openingFloat || 0),
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 3. Create POS Order
  ipcMain.handle('local-engine:create-order', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const result = engine.createOrder({
        sessionToken: session.token,
        tableId: payload.tableId || null,
        guestCount: Number(payload.guestCount || 1),
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 4. Add Item to Order
  ipcMain.handle('local-engine:add-order-item', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const result = engine.addOrderItem({
        sessionToken: session.token,
        orderId: payload.orderId,
        productId: payload.productId,
        productName: payload.productName,
        quantity: Number(payload.quantity),
        unitPrice: Number(payload.unitPrice),
        stationCode: payload.stationCode || 'kitchen',
        notes: payload.notes || null,
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 5. Send Order to Kitchen (KDS)
  ipcMain.handle('local-engine:send-kitchen', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const result = engine.sendOrderToKitchen({
        sessionToken: session.token,
        orderId: payload.orderId,
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 6. Get Kitchen Orders
  ipcMain.handle('local-engine:get-kitchen-orders', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const orders = engine.getKitchenOrders({
        branchId: session.branchId,
        stationCode: payload.stationCode || null,
      });
      return { success: true, orders };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 7. Authoritative Order Settlement (C0 Guard: Front-end cannot pass cashierId, branchId, or soldItemsCost)
  ipcMain.handle('local-engine:settle-order', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const result = engine.settleOrder({
        sessionToken: session.token,
        orderId: payload.orderId,
        warehouseId: payload.warehouseId,
        paymentMethod: payload.paymentMethod || 'cash',
        amount: Number(payload.amount),
        idempotencyKey: payload.idempotencyKey,
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 8. POS Workspace Data (Tables, Active Orders, Items, Kitchen Status)
  ipcMain.handle('local-engine:get-pos-workspace', async (_event) => {
    try {
      const session = getVerifiedSession();
      const data = engine.getPosWorkspaceData({ branchId: session.branchId });
      return { success: true, ...data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 9. Menu Catalog Products
  ipcMain.handle('local-engine:get-products', async (_event) => {
    try {
      const session = getVerifiedSession();
      const products = engine.getProducts({ branchId: session.branchId });
      return { success: true, products };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 10. Floor Tables
  ipcMain.handle('local-engine:get-tables', async (_event) => {
    try {
      const session = getVerifiedSession();
      const tables = engine.getTables({ branchId: session.branchId });
      return { success: true, tables };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 11. Shift Summary
  ipcMain.handle('local-engine:get-shift-summary', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const shiftId = payload.shiftId || session.shiftId;
      if (!shiftId) {
        throw new Error('NO_SHIFT_AVAILABLE');
      }
      const summary = engine.getShiftSummary({ shiftId });
      return { success: true, ...summary };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 12. Inventory Balance
  ipcMain.handle('local-engine:get-inventory-balance', async (_event, payload = {}) => {
    try {
      const session = getVerifiedSession();
      const balance = engine.getInventoryBalance({
        branchId: session.branchId,
        warehouseId: payload.warehouseId,
        itemId: payload.itemId,
      });
      return { success: true, ...balance };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  return engine;
}

module.exports = {
  registerLocalEngineIPC,
};
