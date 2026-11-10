'use strict';

/**
 * Premier OS - Windows Local Transactional Database Schema
 * Engine: SQLite 3 with WAL mode, foreign keys, and ACID transactions.
 * Single source of truth on Windows when operating offline in restaurants.
 */

const SCHEMA_SQL = `
-- Pragmas are configured per-connection in engine.cjs:
-- PRAGMA journal_mode = WAL;
-- PRAGMA foreign_keys = ON;
-- PRAGMA busy_timeout = 5000;

-- 1. Branches
CREATE TABLE IF NOT EXISTS local_branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Roles & Permissions
CREATE TABLE IF NOT EXISTS local_roles (
  name TEXT PRIMARY KEY,
  permissions TEXT NOT NULL DEFAULT '[]', -- JSON array of granted permission strings
  description TEXT
);

-- 3. Users (Cashiers, Waiters, Managers, Kitchen Staff)
CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES local_roles(name),
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Active Sessions (Electron Main Process Verified Tokens)
CREATE TABLE IF NOT EXISTS local_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  role TEXT NOT NULL REFERENCES local_roles(name),
  shift_id TEXT REFERENCES local_shifts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

-- 5. Warehouses
CREATE TABLE IF NOT EXISTS local_warehouses (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Shifts
CREATE TABLE IF NOT EXISTS local_shifts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  cashier_id TEXT NOT NULL REFERENCES local_users(id),
  status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
  opening_float REAL NOT NULL DEFAULT 0.0,
  closing_cash REAL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- 7. Tables / Floor Plan
CREATE TABLE IF NOT EXISTS local_tables (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  table_number TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'occupied', 'reserved')),
  active_order_id TEXT,
  UNIQUE(branch_id, table_number)
);

-- 8. Products / Menu Catalog Cache
CREATE TABLE IF NOT EXISTS local_products (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  category_id TEXT,
  category_name TEXT,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  price REAL NOT NULL CHECK(price >= 0),
  cost REAL NOT NULL DEFAULT 0.0 CHECK(cost >= 0),
  station_code TEXT NOT NULL DEFAULT 'kitchen',
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Product Recipes & Ingredients (Raw Material BOM)
CREATE TABLE IF NOT EXISTS local_product_recipes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  ingredient_item_id TEXT NOT NULL,
  quantity_required REAL NOT NULL CHECK(quantity_required > 0),
  unit_of_measure TEXT NOT NULL DEFAULT 'unit',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, ingredient_item_id)
);

-- 10. Orders
CREATE TABLE IF NOT EXISTS local_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  table_id TEXT REFERENCES local_tables(id),
  shift_id TEXT REFERENCES local_shifts(id),
  created_by TEXT NOT NULL REFERENCES local_users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'sent_to_kitchen', 'completed', 'cancelled')),
  guest_count INTEGER NOT NULL DEFAULT 1 CHECK(guest_count >= 1),
  subtotal REAL NOT NULL DEFAULT 0.0 CHECK(subtotal >= 0),
  discount_amount REAL NOT NULL DEFAULT 0.0 CHECK(discount_amount >= 0),
  tax_amount REAL NOT NULL DEFAULT 0.0 CHECK(tax_amount >= 0),
  total_amount REAL NOT NULL DEFAULT 0.0 CHECK(total_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. Order Items
CREATE TABLE IF NOT EXISTS local_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES local_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  total_price REAL NOT NULL CHECK(total_price >= 0),
  sent_quantity REAL NOT NULL DEFAULT 0.0 CHECK(sent_quantity >= 0),
  station_code TEXT NOT NULL DEFAULT 'kitchen',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12. Kitchen Sends (Local KDS Dispatch)
CREATE TABLE IF NOT EXISTS local_kitchen_sends (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES local_orders(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES local_order_items(id),
  station_code TEXT NOT NULL,
  sent_quantity REAL NOT NULL CHECK(sent_quantity > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'ready', 'served', 'cancelled')),
  sent_by TEXT NOT NULL REFERENCES local_users(id),
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 13. Sales / Invoices
CREATE TABLE IF NOT EXISTS local_sales (
  id TEXT PRIMARY KEY,
  order_id TEXT UNIQUE REFERENCES local_orders(id),
  invoice_number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  shift_id TEXT REFERENCES local_shifts(id),
  cashier_id TEXT NOT NULL REFERENCES local_users(id),
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  discount_amount REAL NOT NULL DEFAULT 0.0 CHECK(discount_amount >= 0),
  tax_amount REAL NOT NULL DEFAULT 0.0 CHECK(tax_amount >= 0),
  total_amount REAL NOT NULL CHECK(total_amount >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 14. Payments
CREATE TABLE IF NOT EXISTS local_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES local_sales(id),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'card', 'transfer', 'credit')),
  amount REAL NOT NULL CHECK(amount > 0),
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 15. Inventory Movements (Stock Ledger)
CREATE TABLE IF NOT EXISTS local_inventory_movements (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  warehouse_id TEXT NOT NULL REFERENCES local_warehouses(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('raw_material', 'product')),
  item_id TEXT NOT NULL,
  delta REAL NOT NULL, -- negative for sales/consumption, positive for purchases/replenishment
  unit_cost REAL NOT NULL DEFAULT 0.0,
  total_cost REAL NOT NULL DEFAULT 0.0,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('sale', 'purchase', 'adjustment', 'waste', 'transfer')),
  reference_id TEXT, -- sale_id, order_id, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 16. Double-Entry Journal Entries
CREATE TABLE IF NOT EXISTS local_journal_entries (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES local_branches(id),
  entry_number TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL DEFAULT (date('now')),
  reference_type TEXT NOT NULL, -- 'sale', 'payment', 'purchase', etc.
  reference_id TEXT,
  description TEXT NOT NULL,
  total_debit REAL NOT NULL CHECK(total_debit >= 0),
  total_credit REAL NOT NULL CHECK(total_credit >= 0),
  is_balanced INTEGER NOT NULL CHECK(is_balanced = 1 AND abs(total_debit - total_credit) < 0.0001),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 17. Journal Lines (Debits and Credits)
CREATE TABLE IF NOT EXISTS local_journal_lines (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL REFERENCES local_journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0.0 CHECK(debit >= 0),
  credit REAL NOT NULL DEFAULT 0.0 CHECK(credit >= 0),
  CHECK(debit > 0 OR credit > 0)
);

-- 18. Cloud Outbox (Durable sync to Supabase when online)
CREATE TABLE IF NOT EXISTS local_outbox (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'close'
  payload TEXT NOT NULL, -- JSON
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'synced', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 19. Idempotency Keys (Replay prevention)
CREATE TABLE IF NOT EXISTS local_idempotency_keys (
  key TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_payload TEXT NOT NULL, -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance and Integrity Indexes
CREATE INDEX IF NOT EXISTS idx_local_orders_branch_status ON local_orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_local_order_items_order ON local_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_local_kitchen_sends_order ON local_kitchen_sends(order_id, status);
CREATE INDEX IF NOT EXISTS idx_local_inventory_item ON local_inventory_movements(branch_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_local_journal_lines_entry ON local_journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_local_outbox_pending ON local_outbox(branch_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_local_sessions_token ON local_sessions(token);
CREATE INDEX IF NOT EXISTS idx_local_products_branch ON local_products(branch_id, is_available);
CREATE INDEX IF NOT EXISTS idx_local_product_recipes_prod ON local_product_recipes(product_id);
`;

function initDatabase(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA_SQL);
}

module.exports = {
  SCHEMA_SQL,
  initDatabase,
};
