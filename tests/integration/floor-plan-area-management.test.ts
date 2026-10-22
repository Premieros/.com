import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const conn = process.env.SUPABASE_DB_URL;
if (!conn) throw new Error('SUPABASE_DB_URL required');

describe('floor plan custom area management', () => {
  const db = new Client({ connectionString: conn });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('manages only own-tenant areas, preserves Main Area and rejects deletion of populated areas', async () => {
    const [orgA, orgB, branchA, branchB, ownerId] = Array.from({ length: 5 }, () => randomUUID());
    const suffix = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'CI area A',$2),($3,'CI area B',$4)",
        [orgA,'ci-area-a-'+suffix,orgB,'ci-area-b-'+suffix]);
      await db.query("INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Main A',$2),($3,'Main B',$4)",
        [branchA,orgA,branchB,orgB]);
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",
        [ownerId,'ci-area-owner-'+suffix+'@example.invalid']);
      await db.query("INSERT INTO public.users(id,email,full_name,username,role,branch_id,is_active) VALUES($1,$2,'Test Owner',$3,'owner',$4,true)",
        [ownerId,'ci-area-owner-'+suffix+'@example.invalid','ci-owner-'+suffix,branchA]);
      await db.query("SELECT set_config('app.register_branch','off',true)");
      await db.query("SELECT set_config('app.user_id',$1,true)",[ownerId]);

      const create = async (branchId: string, name: string) => {
        const res = await db.query<{ value:{success:boolean;error?:string;area_id?:string} }>(
          'SELECT public.floor_plan_create_area($1,$2) value',[branchId,name]);
        return res.rows[0].value;
      };

      const ownArea = await create(branchA,'Terrace');
      expect(ownArea,JSON.stringify(ownArea)).toMatchObject({success:true});
      expect(ownArea.area_id).toBeTruthy();

      const foreign = await create(branchB,'Should never exist');
      expect(foreign).toMatchObject({success:false,error:'PERMISSION_DENIED'});
      expect(await create(branchA,'  terrace  ')).toMatchObject({success:false,error:'AREA_NAME_EXISTS'});

      const second = await create(branchA,'Balcony');
      expect(second.success).toBe(true);
      const rename = await db.query<{value:{success:boolean;error?:string}}>(
        "SELECT public.floor_plan_rename_area($1,$2) value",[second.area_id,'Balcony renamed']);
      expect(rename.rows[0].value.success).toBe(true);

      const duplicate = await db.query<{value:{success:boolean;error?:string}}>(
        "SELECT public.floor_plan_rename_area($1,$2) value",[second.area_id,' TERRACE ']);
      expect(duplicate.rows[0].value.error).toBe('AREA_NAME_EXISTS');

      const main = await db.query<{id:string}>(
        'SELECT id FROM public.dining_areas WHERE branch_id=$1 AND is_default LIMIT 1',[branchA]);
      expect(main.rows.length).toBe(1);
      const mainDelete = await db.query<{value:{success:boolean;error?:string}}>(
        'SELECT public.floor_plan_delete_area($1) value',[main.rows[0].id]);
      expect(mainDelete.rows[0].value.error).toBe('DEFAULT_AREA_FIXED');

      const mainRename = await db.query<{value:{success:boolean;error?:string}}>(
        "SELECT public.floor_plan_rename_area($1,'Wrong name') value",[main.rows[0].id]);
      expect(mainRename.rows[0].value.error).toBe('DEFAULT_AREA_FIXED');

      const tableId = randomUUID();
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query(`INSERT INTO public.dining_tables(id,branch_id,area_id,name,status,capacity,shape,layout,is_active,is_demo)
        VALUES($1,$2,$3,'CI Custom Table','vacant',4,'rect','{"x":0,"y":0,"w":110,"h":70}',true,false)`,
        [tableId,branchA,ownArea.area_id]);
      await db.query("SELECT set_config('app.register_branch','off',true)");
      const populated = await db.query<{value:{success:boolean;error?:string;tables?:number}}>(
        'SELECT public.floor_plan_delete_area($1) value',[ownArea.area_id]);
      expect(populated.rows[0].value).toMatchObject({success:false,error:'AREA_HAS_TABLES',tables:1});

      const safeDelete = await db.query<{value:{success:boolean;deleted?:boolean}}>(
        'SELECT public.floor_plan_delete_area($1) value',[second.area_id]);
      expect(safeDelete.rows[0].value).toMatchObject({success:true,deleted:true});

      const counts = await db.query<{total:number;foreign:number;remaining:number}>(
        `SELECT (SELECT count(*)::int FROM public.dining_tables WHERE id=$1) total,
         (SELECT count(*)::int FROM public.dining_areas WHERE branch_id=$2 AND name='Should never exist') foreign,
         (SELECT count(*)::int FROM public.dining_areas WHERE id=$3) remaining`,
        [tableId,branchB,ownArea.area_id]);
      expect(counts.rows[0]).toEqual({total:1,foreign:0,remaining:1});
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
