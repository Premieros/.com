import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const branch = '00000000-0000-4000-8000-000000000001';
const otherBranch = '00000000-0000-4000-8000-000000000002';
const raw = '00000000-0000-4000-8000-000000000010';
const idle = '00000000-0000-4000-8000-000000000011';
const lot = '00000000-0000-4000-8000-000000000012';
const migration = readFileSync('supabase/migrations/20261125200000_workspace_operational_insights.sql', 'utf8');

describe('workspace branch reporting SQL', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT NULLIF(current_setting('test.subject', true), '')::uuid $$;
      CREATE FUNCTION public.user_may_access_branch(id uuid) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT id = '${branch}'::uuid $$;
      CREATE FUNCTION public.can_permission(permission text) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT permission <> 'history.unlimited' OR current_setting('test.history', true) = 'yes' $$;

      CREATE TABLE orders (branch_id uuid, order_type text, status text, created_at timestamptz, qr_revision bigint);
      CREATE TABLE v_stock_balances_unified (item_type text, item_id uuid, branch_id uuid, item_name text, quantity numeric);
      CREATE TABLE inventory_ledger (product_id uuid, raw_material_id uuid, branch_id uuid, created_at timestamptz, entry_type text, quantity numeric);
      CREATE TABLE inventory_unit_entries (unit_id uuid, branch_id uuid, created_at timestamptz, entry_type text, quantity numeric);
      CREATE TABLE raw_materials (id uuid, branch_id uuid, name text);
      CREATE TABLE inventory_units (id uuid, branch_id uuid, name text);
      CREATE TABLE raw_material_batches (id uuid, raw_material_id uuid, branch_id uuid, quantity numeric, batch_number text, expiry_date date);
      CREATE TABLE inventory_unit_batches (id uuid, unit_id uuid, branch_id uuid, quantity numeric, batch_number text, expiry_date date);

      INSERT INTO orders VALUES
        ('${branch}', 'delivery', 'completed', now() - interval '1 day', 1),
        ('${branch}', 'takeaway', 'completed', now() - interval '1 day', 0),
        ('${branch}', 'delivery', 'cancelled', now() - interval '1 day', 1),
        ('${otherBranch}', 'delivery', 'completed', now() - interval '1 day', 1);
      INSERT INTO v_stock_balances_unified VALUES
        ('raw', '${raw}', '${branch}', 'Beans', 24),
        ('raw', '${idle}', '${branch}', 'Spare', 9);
      INSERT INTO inventory_ledger VALUES
        (NULL, '${raw}', '${branch}', now()-interval '2 days', 'kitchen_send', -15),
        (NULL, '${raw}', '${branch}', now()-interval '2 days', 'kitchen_void', 3),
        (NULL, '${raw}', '${branch}', now()-interval '2 days', 'transfer', -48);
      INSERT INTO raw_materials VALUES ('${raw}', '${branch}', 'Beans');
      INSERT INTO raw_material_batches VALUES ('${lot}', '${raw}', '${branch}', 3, 'A1', CURRENT_DATE + 2);
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      SET test.subject = '${branch}';
      SET test.history = 'yes';
    `);
    await db.exec(migration);
    await db.exec('SET ROLE authenticated');
  }, 30000);

  afterAll(async () => { await db?.close(); });

  it('counts completed orders separately by source and restricts branch and historical access', async () => {
    const result = await db.query('SELECT channel, order_type, orders::int AS count FROM get_workspace_order_hours($1, 7) ORDER BY channel', [branch]);
    expect(result.rows).toEqual([
      { channel: 'pos', order_type: 'takeaway', count: 1 },
      { channel: 'website', order_type: 'delivery', count: 1 },
    ]);
    await expect(db.query('SELECT * FROM get_workspace_order_hours($1, 7)', [otherBranch])).rejects.toThrow('WORKSPACE_ORDER_HOURS_UNAVAILABLE');
    await db.exec("SET test.history = 'no'");
    await expect(db.query('SELECT * FROM get_workspace_order_hours($1, 30)', [branch])).rejects.toThrow('WORKSPACE_ORDER_HOURS_UNAVAILABLE');
    await db.exec("SET test.history = 'yes'");
  });

  it('nets kitchen reversals, excludes transfers from demand and exposes lots without a history permission', async () => {
    const cover = await db.query("SELECT item_name, usage_quantity::int AS consumption, cover_days::int AS days FROM get_workspace_stock_health($1, 'cover', 0)", [branch]);
    expect(cover.rows).toEqual([{ item_name: 'Beans', consumption: 12, days: 60 }]);
    const unused = await db.query("SELECT item_name FROM get_workspace_stock_health($1, 'idle', 0)", [branch]);
    expect(unused.rows).toEqual([{ item_name: 'Spare' }]);
    await db.exec("SET test.history = 'no'");
    const lots = await db.query("SELECT batch_id, batch_number FROM get_workspace_stock_health($1, 'expiry', 0)", [branch]);
    expect(lots.rows).toEqual([{ batch_id: lot, batch_number: 'A1' }]);
    await expect(db.query("SELECT * FROM get_workspace_stock_health($1, 'cover', 0)", [branch])).rejects.toThrow('WORKSPACE_STOCK_HISTORY_UNAVAILABLE');
  });
});
