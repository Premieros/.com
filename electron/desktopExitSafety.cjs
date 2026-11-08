'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openLocalDraftJournal } = require('./localDraftJournal.cjs');

const SAFETY_SCRIPT = String.raw`(async () => {
  // Executed only inside the trusted, locally bundled Premier window.
  // Read-only; never opens a new database or clears/retries anything.
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function')
      return { safe:false, reason:'INDEXEDDB_CANNOT_BE_VERIFIED' };
    const databases = await indexedDB.databases();
    if (!databases.some(db => db.name === 'premier_pos_offline_db'))
      return { safe:false, reason:'LOCAL_OUTBOX_NOT_INITIALIZED' };
    const db = await new Promise((resolve,reject) => {
      const req = indexedDB.open('premier_pos_offline_db');
      req.onupgradeneeded = () => {
        req.transaction.abort(); // Never auto-create/upgrade during a quit check.
        reject(new Error('LOCAL_DB_VERSION_UNEXPECTED'));
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('LOCAL_DB_BLOCKED'));
    });
    try {
      const names = ['sales_queue','orders_queue','outbox_operations','local_stock_movements'];
      if (!names.every(name => db.objectStoreNames.contains(name)))
        return { safe:false, reason:'LOCAL_OUTBOX_STORES_MISSING' };
      const rows = await new Promise((resolve,reject) => {
        const tx = db.transaction(names,'readonly');
        const values = {};
        tx.oncomplete = () => resolve(values);
        tx.onerror = () => reject(tx.error || new Error('LOCAL_OUTBOX_READ_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('LOCAL_OUTBOX_READ_ABORTED'));
        for (const name of names) {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => { values[name] = req.result || []; };
          req.onerror = () => reject(req.error || new Error('LOCAL_OUTBOX_READ_FAILED'));
        }
      });
      // Even one unsent print/order/stock operation blocks automatic upgrade.
      const pending = rows.sales_queue.length > 0 ||
        rows.orders_queue.some(row => row.status !== 'synced') ||
        rows.outbox_operations.some(row => !['synced','completed','confirmed'].includes(row.status)) ||
        rows.local_stock_movements.some(row => row.synced !== true);
      return pending ? { safe:false, reason:'PENDING_LOCAL_OPERATIONS' }
        : { safe:true, reason:'LOCAL_OUTBOX_CLEAN' };
    } finally {
      db.close();
    }
  } catch {
    return { safe:false, reason:'LOCAL_OUTBOX_READ_FAILED' };
  }
})()`;

async function inspectDesktopExitSafety({
  mainWindow, localAppUrl, printerQueue, app, safeStorage,
  execute = (win, script) => win.webContents.executeJavaScript(script),
}) {
  if (!mainWindow || mainWindow.isDestroyed?.() || !localAppUrl) {
    return { safe:false, reason:'LOCAL_WINDOW_UNAVAILABLE' };
  }
  if (printerQueue?.hasPending?.() !== false) {
    return { safe:false, reason:'PRINT_QUEUE_NOT_IDLE' };
  }
  const currentUrl = mainWindow.webContents?.getURL?.();
  if (!currentUrl || new URL(currentUrl).origin !== new URL(localAppUrl).origin) {
    return { safe:false, reason:'LOCAL_WINDOW_ORIGIN_UNTRUSTED' };
  }
  let outbox;
  try {
    outbox = await execute(mainWindow, SAFETY_SCRIPT);
  } catch {
    return { safe:false, reason:'LOCAL_OUTBOX_QUERY_UNAVAILABLE' };
  }
  if (outbox?.safe !== true) {
    return { safe:false, reason:outbox?.reason || 'LOCAL_OUTBOX_NOT_SAFE' };
  }
  // Drafts are encrypted and remain durable, but until backup/recovery is
  // proven, any unsynced draft blocks silent installer replacement.
  const filename = path.join(app.getPath('userData'), 'draft-journal-v1.sqlite');
  if (fs.existsSync(filename)) {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      return { safe:false, reason:'LOCAL_DRAFT_ENCRYPTION_UNAVAILABLE' };
    }
    let journal;
    try {
      journal = openLocalDraftJournal({ filename, codec:safeStorage });
      const count = journal.verifyIntegrity().verifiedDrafts;
      if (count !== 0) return { safe:false, reason:'PENDING_LOCAL_DRAFTS' };
    } catch {
      return { safe:false, reason:'LOCAL_DRAFT_READ_FAILED' };
    } finally {
      journal?.close();
    }
  }
  return { safe:true, reason:'LOCAL_DATA_IDLE' };
}

module.exports = { inspectDesktopExitSafety, SAFETY_SCRIPT };
