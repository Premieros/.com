'use strict';

const path = require('node:path');
const { PremierLocalEngine } = require('./engine.cjs');

/**
 * Connects the PremierLocalEngine to Electron's IPC bus.
 * Exposes ACID offline contracts to the renderer securely via preload.
 */
function registerLocalEngineIPC(ipcMain, app) {
  const dbDir = app ? app.getPath('userData') : process.cwd();
  const dbPath = process.env.PREMIER_LOCAL_DB_PATH || path.join(dbDir, 'premier_local.db');

  const engine = new PremierLocalEngine(dbPath);

  ipcMain.handle('local-engine:open-shift', async (_event, payload) => {
    try {
      return { success: true, ...engine.openShift(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:create-order', async (_event, payload) => {
    try {
      return { success: true, ...engine.createOrder(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:add-order-item', async (_event, payload) => {
    try {
      return { success: true, ...engine.addOrderItem(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:send-kitchen', async (_event, payload) => {
    try {
      return { success: true, ...engine.sendOrderToKitchen(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:get-kitchen-orders', async (_event, payload) => {
    try {
      const orders = engine.getKitchenOrders(payload || {});
      return { success: true, orders };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:settle-order', async (_event, payload) => {
    try {
      const result = engine.settleOrder(payload);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:get-inventory-balance', async (_event, payload) => {
    try {
      const balance = engine.getInventoryBalance(payload);
      return { success: true, ...balance };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('local-engine:get-shift-summary', async (_event, payload) => {
    try {
      const summary = engine.getShiftSummary(payload);
      return { success: true, ...summary };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  return engine;
}

module.exports = {
  registerLocalEngineIPC,
};
