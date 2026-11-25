import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const url=process.env.SUPABASE_DB_URL;
const disposable=Boolean(url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
(disposable ? describe : describe.skip)('PR318 atomic legacy stock count edit candidate',()=>{
  const db=new Client({connectionString:url});
  beforeAll(async()=>{await db.connect()});
  afterAll(async()=>{await db.end()});
  it('rolls back late failed line, accepts zero and rejects stale snapshot',async()=>{
    const org=randomUUID(),branch=randomUUID(),user=randomUUID(),wh=randomUUID(),count=randomUUID(),pid=randomUUID(),second=randomUUID();
    const tag=randomUUID().slice(0,8),email='count-'+tag+'@ci.invalid';
    await db.query('BEGIN');
    try {
      await db.query("insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing");
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',[org,'CI Atomic','ci-atomic-'+tag]);
      await db.query("insert into public.branches(id,name,is_active,organization_id) values($1,'CI Count',true,$2)",[branch,org]);
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',[user,email]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Atomic','super_admin',$3,true)",[user,email,branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",[user,JSON.stringify({sub:user,role:'authenticated'})]);

      await db.query("insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI Warehouse',$2,true,true)",[wh,branch]);
      await db.query("insert into public.products(id,name,sku,branch_id,product_type,cost_price,sale_price) values($1,'CI Count first',$2,$3,'ready',1,2),($4,'CI Count second',$5,$3,'ready',1,2)",[pid,'CI-F-'+tag,branch,second,'CI-S-'+tag]);
      await db.query("insert into public.stock_counts(id,branch_id,warehouse_id,status) values($1,$2,$3,'draft')",[count,branch,wh]);
      await db.query("insert into public.stock_count_items(stock_count_id,product_id,system_quantity,counted_quantity,unit_cost) values($1,$2,2,2,1)",[count,pid]);
      await db.query(readFileSync('scripts/db/candidates/pr_318_atomic_stock_count_edit_NOT_FOR_PRODUCTION.sql','utf8'));
      const call='select public.pr318_edit_stock_count_candidate($1,$2,$3) result';
      const snapshot=JSON.stringify([{product_id:pid,counted_quantity:2,reason:null}]);
      await db.query('SAVEPOINT bad_count');
      await db.query('SET LOCAL ROLE authenticated');
      await expect(db.query(call,[count,snapshot,JSON.stringify([{product_id:pid,counted_quantity:0},{product_id:second,counted_quantity:1e20}])])).rejects.toThrow('COUNT_LINE_SAVE_FAILED');
      await db.query('ROLLBACK TO SAVEPOINT bad_count');
      await db.query('RESET ROLE');
      expect((await db.query('select product_id,counted_quantity::float8 qty from public.stock_count_items where stock_count_id=$1',[count])).rows).toEqual([{product_id:pid,qty:2}]);
      await db.query('SET LOCAL ROLE authenticated');
      expect((await db.query(call,[count,snapshot,JSON.stringify([{product_id:pid,counted_quantity:0,reason:null}])])).rows[0].result.success).toBe(true);
      await db.query('RESET ROLE');
      expect((await db.query('select counted_quantity::float8 qty from public.stock_count_items where stock_count_id=$1',[count])).rows[0].qty).toBe(0);
      await db.query('SAVEPOINT stale_count');
      await db.query('SET LOCAL ROLE authenticated');
      await expect(db.query(call,[count,snapshot,JSON.stringify([{product_id:pid,counted_quantity:3}])])).rejects.toThrow('COUNT_REFRESH_REQUIRED');
      await db.query('ROLLBACK TO SAVEPOINT stale_count');
      await db.query('RESET ROLE');
    } finally {await db.query('ROLLBACK')}
  });
});
