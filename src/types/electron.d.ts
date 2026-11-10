export interface LocalEngineAPI {
  login: (credentials: { userId: string; branchId: string }) => Promise<{ success: boolean; session?: Record<string, unknown>; error?: string }>;
  openShift: (payload?: { openingFloat?: number }) => Promise<{ success: boolean; shift?: Record<string, unknown>; error?: string }>;
  createOrder: (payload?: { tableId?: string | null; guestCount?: number }) => Promise<{ success: boolean; order?: Record<string, unknown>; error?: string }>;
  addOrderItem: (payload: { orderId: string; productId: string; productName: string; quantity: number; unitPrice: number; stationCode?: string; notes?: string | null }) => Promise<{ success: boolean; item?: Record<string, unknown>; order?: Record<string, unknown>; error?: string }>;
  sendToKitchen: (payload: { orderId: string }) => Promise<{ success: boolean; dispatchedCount?: number; sends?: Array<Record<string, unknown>>; orderStatus?: string; error?: string }>;
  getKitchenOrders: (payload?: { stationCode?: string | null }) => Promise<{ success: boolean; orders?: Array<Record<string, unknown>>; error?: string }>;
  settleOrder: (payload: { orderId: string; warehouseId: string; paymentMethod?: string; amount: number; idempotencyKey: string }) => Promise<{ success: boolean; saleId?: string; invoiceNumber?: string; orderId?: string; totalAmount?: number; calculatedCost?: number; error?: string }>;
  getPosWorkspace: () => Promise<{ success: boolean; orders?: Array<Record<string, unknown>>; tables?: Array<Record<string, unknown>>; orderItems?: Array<Record<string, unknown>>; kitchenSends?: Array<Record<string, unknown>>; watchedOrderIds?: string[]; error?: string }>;
  getProducts: () => Promise<{ success: boolean; products?: Array<Record<string, unknown>>; error?: string }>;
  getTables: () => Promise<{ success: boolean; tables?: Array<Record<string, unknown>>; error?: string }>;
  getInventoryBalance: (payload: { warehouseId: string; itemId: string }) => Promise<{ success: boolean; balance?: number; error?: string }>;
  getShiftSummary: (payload?: { shiftId?: string }) => Promise<{
    success: boolean;
    shiftId?: string;
    status?: string;
    cashierId?: string;
    openingFloat?: number;
    openedAt?: string;
    closedAt?: string | null;
    totalSales?: number;
    cashCollected?: number;
    cardCollected?: number;
    expectedCashInDrawer?: number;
    salesCount?: number;
    error?: string;
  }>;
}

export interface ElectronAppAPI {
  isElectron: boolean;
  getPrinters: () => Promise<Array<{ name: string; displayName?: string; isDefault?: boolean; status?: number }>>;
  printSilent: (options: { html?: string; text?: string; printerName: string; copies?: number; paperWidthMm?: number }) => Promise<{ success: boolean; error?: string }>;
  kickDrawer: (printerName?: string) => Promise<{ success: boolean; error?: string }>;
  getSystemInfo: () => Promise<{ isElectron: boolean; platform: string; hostname: string }>;
  localEngine?: LocalEngineAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAppAPI;
  }
}
