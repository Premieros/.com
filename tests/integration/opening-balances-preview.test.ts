import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required');

describe('opening balances read-only preview', () => {
  const db = new Client({ connectionString });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('shows per-branch inventory valuation without posting entries or reading another tenant', async () => {
    const [orgA,orgB,branchA,branchB,ownerA,productA,materialA,warehouseA] =
      Array.from({length:8},()=>randomUUID());
    const suffix=randomUUID().slice(0,10);
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug,is_active) VALUES($1,'Opening test A',$2,true),($3,'Opening test B',$4,true)",
        [orgA,'ci-opening-a-'+suffix,orgB,'ci-opening-b-'+suffix]);
      await db.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,'Opening branch A',$2,true),($3,'Opening branch B',$4,true)",
        [branchA,orgA,branchB,orgB]);
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",
        [ownerA,'ci-opening-'+suffix+'@example.invalid']);
      await db.query("INSERT INTO public.users(id,email,full_name,username,role,branch_id,is_active) VALUES($1,$2,'CI Opening owner',$3,'owner',$4,true)",
        [ownerA,'ci-opening-'+suffix+'@example.invalid','ci-opening-'+suffix,branchA]);
      await db.query("INSERT INTO public.products(id,branch_id,name,sale_price) VALUES($1,$2,'Opening product',20)",[productA,branchA]);
      await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id) VALUES($1,$2,'Opening material',$3)",
        [materialA,'CI-OPEN-'+suffix,branchA]);
      await db.query("INSERT INTO public.warehouses(id,branch_id,name) VALUES($1,$2,'Opening warehouse')",
        [warehouseA,branchA]);
      await db.query("INSERT INTO public.inventory_batches(product_id,branch_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,12,7)",
        [productA,branchA,warehouseA]);
      await db.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,3,5)",
        [materialA,branchA,warehouseA]);
      await db.query("SELECT set_config('app.register_branch','off',true)");
      await db.query("SELECT set_config('app.user_id',$1,true)",[ownerA]);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ownerA]);
      await db.query("SELECT set_config('request.jwt.claim.role','authenticated',true)");

      const response=await db.query<{r:{success:boolean;finished?:number;raw?:number;total?:number;has_opening?:boolean;can_post?:boolean;error?:string}}>(
        'SELECT public.preview_opening_balances($1) r',[branchA]);
      expect(response.rows[0].r).toMatchObject({
        success:true,finished:84,raw:15,total:99,has_opening:false,can_post:true
      });

      const foreign=await db.query<{r:{success:boolean;error?:string}}>(
        'SELECT public.preview_opening_balances($1) r',[branchB]);
      expect(foreign.rows[0].r).toMatchObject({success:false,error:'NOT_ALLOWED'});

      const journal=await db.query<{n:number}>(
        "SELECT count(*)::int n FROM public.journal_entries WHERE branch_id=$1 AND reference_type='opening'",[branchA]);
      expect(journal.rows[0].n).toBe(0);
    } finally {
      await db.query('ROLLBACK');
    }
  });
  it('does not grant preview RPC to anonymous callers', async () => {
    const {rows}=await db.query<{allowed:boolean}>(
      "SELECT has_function_privilege('anon','public.preview_opening_balances(uuid)','EXECUTE') allowed");
    expect(rows[0].allowed).toBe(false);
  });
});
