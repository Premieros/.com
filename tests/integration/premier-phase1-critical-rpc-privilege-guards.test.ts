import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required for integration tests');

type Routine = {
  proname: string;
  args: string;
  is_definer: boolean;
  anon_execute: boolean;
  authenticated_execute: boolean;
};

describe('Phase 1 — public sensitive RPC privilege boundaries', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('keeps raw material cost helpers and all FIFO overloads internal to privileged workflows', async () => {
    const { rows } = await db.query<Routine>(`
      select p.proname,pg_get_function_identity_arguments(p.oid) args,
             p.prosecdef is_definer,
             has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
             has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      from pg_proc p
      where p.pronamespace='public'::regnamespace
        and p.proname in ('_raw_remove_fifo','_raw_cost_for_costing','_raw_cost_context_for_costing')
      order by p.proname, args
    `);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.filter(row => row.proname === '_raw_remove_fifo').length).toBeGreaterThanOrEqual(2);
    for (const routine of rows) {
      expect(routine.anon_execute).toBe(false);
      expect(routine.authenticated_execute).toBe(false);
    }
  });

  it('denies anonymous execution of checkout, production, transfers and destructive operations', async () => {
    const names = [
      'process_sale','process_sale_idempotent',
      'complete_production_order','approve_warehouse_transfer',
      'admin_data_delete_section','super_admin_delete_organization',
    ];
    const { rows } = await db.query<Routine>(`
      select p.proname,pg_get_function_identity_arguments(p.oid) args,
             p.prosecdef is_definer,
             has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
             has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      from pg_proc p
      where p.pronamespace='public'::regnamespace
        and p.proname = any($1::text[])
    `, [names]);
    expect(new Set(rows.map(row => row.proname))).toEqual(new Set(names));
    for (const routine of rows) {
      expect(routine.anon_execute).toBe(false);
      expect(routine.authenticated_execute).toBe(true);
      expect(routine.is_definer).toBe(true);
    }
  });

  it('keeps registration as the narrowly identified anonymous entry point', async () => {
    const { rows } = await db.query<Routine>(`
      select p.proname,pg_get_function_identity_arguments(p.oid) args,
             p.prosecdef is_definer,
             has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
             has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
      from pg_proc p
      where p.pronamespace='public'::regnamespace and p.prosecdef
        and has_function_privilege('anon',p.oid,'EXECUTE')
      order by p.proname, args
    `);
    // Registration is still the only anonymous *write* entry point.
    // These four public branch storefront RPCs are explicitly read-only.
    const publicReadOnly = [
      'branch_website_links_public',
      'branch_website_photos_public',
      'branch_website_theme_public',
      'bunker_demo_menu_preview',
    ];
    expect(rows.map(row => row.proname)).toEqual([...publicReadOnly, 'register_trial_tenant']);
    for (const entry of rows) {
      expect(entry.is_definer).toBe(true);
      expect(entry.anon_execute).toBe(true);
      if (entry.proname === 'register_trial_tenant') {
        expect(entry.authenticated_execute).toBe(false);
      } else {
        expect(publicReadOnly).toContain(entry.proname);
        expect(entry.authenticated_execute).toBe(true);
        expect(entry.args).toBe(entry.proname === 'bunker_demo_menu_preview' ? '' : 'p_slug text');
      }
    }
  });
});
