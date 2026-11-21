import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required for database integration tests');

describe('BUNKER live-order handoff safeguards', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('never considers an unconfigured BUNKER menu ready to accept orders', async () => {
    const { rows } = await db.query<{ can_activate: boolean }>(
      'select qr_private.bunker_live_menu_ready() as can_activate',
    );
    // Disposable test DB has no BUNKER staff, stock, or approved costs.
    expect(rows[0]?.can_activate).toBe(false);
  });

  it('protects the readiness check from unauthenticated users', async () => {
    const { rows } = await db.query<{ anon_exec: boolean; authenticated_exec: boolean }>(`
      select has_function_privilege('anon','public.bunker_live_order_readiness(uuid)','EXECUTE') anon_exec,
             has_function_privilege('authenticated','public.bunker_live_order_readiness(uuid)','EXECUTE') authenticated_exec
    `);
    expect(rows[0]?.anon_exec).toBe(false);
    expect(rows[0]?.authenticated_exec).toBe(true);
  });

  it('enforces the BUNKER activation gate on branch settings', async () => {
    const { rows } = await db.query<{ enabled: boolean }>(`
      select t.tgenabled <> 'D' as enabled
      from pg_trigger t
      where t.tgrelid='qr_private.branch_settings'::regclass
        and t.tgname='bunker_live_menu_gate' and not t.tgisinternal
    `);
    expect(rows).toEqual([{ enabled: true }]);
  });

  it('requires cost, authorized staff, a warehouse and kitchen routing', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_functiondef('qr_private.bunker_live_menu_ready()'::regprocedure) as def`,
    );
    const definition = rows[0]?.def ?? '';
    for (const table of ['auth.users', 'organization_members', 'warehouses', 'kitchen_stations', 'menu_products']) {
      expect(definition).toContain(table);
    }
    expect(definition).toContain('cost_price');
  });
});
