import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('raw warehouse movements canonical audit schema parity', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('restores warehouse-level balances with original branch/warehouse/raw material keys', async () => {
    const { rows } = await db.query<{
      has_rls: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
      constraint_count: string;
    }>(`
      SELECT c.relrowsecurity AS has_rls,
        has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
        has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
        (SELECT count(*)::text FROM pg_constraint k WHERE k.conrelid=c.oid
          AND k.conname IN (
            'raw_warehouse_balances_v2_pkey',
            'raw_warehouse_balances_v2_branch_id_fkey',
            'raw_warehouse_balances_v2_warehouse_id_fkey',
            'raw_warehouse_balances_v2_raw_material_id_fkey'
          )) AS constraint_count
      FROM pg_class c WHERE c.oid='private.raw_warehouse_balances_v2'::regclass
    `);
    expect(rows).toMatchObject([{
      has_rls: true, anon_select: false,
      authenticated_select: false, constraint_count: '4',
    }]);
  });

  it('restores the private movement idempotency/ledger contract without exposing it to browser roles', async () => {
    const { rows } = await db.query<{
      table_exists: boolean;
      has_rls: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
      constraint_count: string;
    }>(`
      SELECT
        to_regclass('private.raw_warehouse_movements_v2') IS NOT NULL AS table_exists,
        c.relrowsecurity AS has_rls,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
        has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
        (
          SELECT count(*)::text FROM pg_constraint k
          WHERE k.conrelid=c.oid
            AND k.conname IN (
              'raw_warehouse_movements_v2_pkey',
              'raw_warehouse_movements_v2_ledger_id_key',
              'raw_warehouse_movements_v2_ledger_id_fkey',
              'raw_warehouse_movements_v2_check',
              'raw_warehouse_movements_v2_quantity_delta_check',
              'raw_warehouse_movements_v2_unit_cost_check'
            )
        ) AS constraint_count
      FROM pg_class c WHERE c.oid='private.raw_warehouse_movements_v2'::regclass
    `);
    expect(rows).toMatchObject([{
      table_exists: true,
      has_rls: true,
      anon_select: false,
      authenticated_select: false,
      constraint_count: '6',
    }]);
  });
});
