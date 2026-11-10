const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('pos:get-printers'),
  printSilent: (options) => ipcRenderer.invoke('pos:print-silent', options),
  kickDrawer: (printerName) => ipcRenderer.invoke('pos:kick-drawer', printerName),
  getSystemInfo: () => ipcRenderer.invoke('pos:get-system-info'),
  localEngine: Object.freeze({
    login: (credentials) => ipcRenderer.invoke('local-engine:login', credentials),
    openShift: (payload) => ipcRenderer.invoke('local-engine:open-shift', payload),
    createOrder: (payload) => ipcRenderer.invoke('local-engine:create-order', payload),
    addOrderItem: (payload) => ipcRenderer.invoke('local-engine:add-order-item', payload),
    sendToKitchen: (payload) => ipcRenderer.invoke('local-engine:send-kitchen', payload),
    getKitchenOrders: (payload) => ipcRenderer.invoke('local-engine:get-kitchen-orders', payload),
    settleOrder: (payload) => ipcRenderer.invoke('local-engine:settle-order', payload),
    getPosWorkspace: () => ipcRenderer.invoke('local-engine:get-pos-workspace'),
    getProducts: () => ipcRenderer.invoke('local-engine:get-products'),
    getTables: () => ipcRenderer.invoke('local-engine:get-tables'),
    getInventoryBalance: (payload) => ipcRenderer.invoke('local-engine:get-inventory-balance', payload),
    getShiftSummary: (payload) => ipcRenderer.invoke('local-engine:get-shift-summary', payload),
  }),
}));
