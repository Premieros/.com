import type { Product, Category } from '@/lib/types';

export interface LocalStockMovement {
  id: string; // client UUID
  productId: string;
  branchId: string;
  warehouseId?: string | null;
  quantityDelta: number; // e.g. -2 for sale
  reason: 'sale' | 'waste' | 'transfer' | 'adjustment' | 'production';
  referenceId: string; // sale invoice or local id
  createdAt: string;
  synced: boolean;
}

export interface OutboxOperation {
  id: string; // local UUID
  entityType: 'sale' | 'expense' | 'customer' | 'movement';
  entityId: string;
  operationType: 'create' | 'update' | 'delete' | 'rpc';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  retryCount: number;
  lastError?: string;
  serverId?: string;
  createdByUserId?: string;
}

export interface CachedStockEntry {
  id: string; // `${branchId}_${productId}`
  branchId: string;
  productId: string;
  warehouseId?: string | null;
  serverQuantity: number;
  lastSyncedAt: string;
}

export interface CachedCatalog {
  products: Product[];
  categories: Category[];
  cachedAt: string;
  branchId: string;
}
