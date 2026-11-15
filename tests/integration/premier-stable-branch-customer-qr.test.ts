import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
const disposable = Boolean(dbUrl && (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('[::1]')));

(disposable ? describe : describe.skip)('Stable branch-wide customer QR', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('reprints the same branch token, allows guest table selection, and denies other branches', async () => {
    const org = randomUUID(), branch = randomUUID(), otherBranch = randomUUID();
    const table1 = randomUUID(), table2 = randomUUID(), foreignTable = randomUUID();
    const user = randomUUID(), marker = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(
        `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
         values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
         on conflict(role) do nothing`);
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org,'CI Branch QR',`ci-stable-qr-${marker}`]);
      await db.query('insert into public.branches(id,name,organization_id) values($1,$2,$3),($4,$5,$3)',
        [branch,'QR branch',org,otherBranch,'Other branch']);
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user,`ci-branch-qr-${marker}@ci.invalid`]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'QR admin','super_admin',$3,true)",
        [user,`ci-branch-qr-${marker}@ci.invalid`,branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [user,JSON.stringify({sub:user,role:'authenticated'})]);
      await db.query(
        `insert into public.dining_tables(id,branch_id,name)
         values($1,$2,'Table 1'),($3,$2,'Table 2'),($4,$5,'Foreign Table')`,
        [table1,branch,table2,foreignTable,otherBranch]);

      const first = await db.query<{token:string}>(
        'select public.qr_branch_code($1) token', [branch]);
      const token = first.rows[0].token;
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      const again = await db.query<{token:string}>(
        'select public.qr_branch_code($1) token', [branch]);
      expect(again.rows[0].token).toBe(token);

      const menu = await db.query<{data:{table_id:null;tables:{id:string}[]}}>(
        'select public.qr_menu($1) data',[token]);
      expect(menu.rows[0].data.table_id).toBeNull();
      const visibleTableIds = menu.rows[0].data.tables.map(t=>t.id);
      expect(visibleTableIds).toContain(table1);
      expect(visibleTableIds).toContain(table2);
      expect(visibleTableIds).not.toContain(foreignTable);

      // Legacy per-table tokens remain independent of the permanent branch QR.
      const legacy = await db.query<{token:string}>('select public.qr_rotate($1,true) token',[table1]);
      expect(legacy.rows[0].token).not.toBe(token);
      expect((await db.query<{token:string}>('select public.qr_branch_code($1) token',[branch])).rows[0].token).toBe(token);

      // A branch QR must never silently fall back to its technical origin table.
      const payload = JSON.stringify([{product_id:randomUUID(),quantity:1,price:1,notes:''}]);
      await expect(db.query('select qr_private.submit_selected_core($1,$2,$3::jsonb,$4)',
        [token,randomUUID(),payload,null])).rejects.toThrow('QR_TABLE_INVALID');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
