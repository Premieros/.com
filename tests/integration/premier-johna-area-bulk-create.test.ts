import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required for DB integration');

describe('Ported johna-s dining area with atomic table creation', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });
  it('creates the chosen number of branch-owned tables in one transaction with permissions', async () => {
    const org = randomUUID(), branch = randomUUID(), owner = randomUUID();
    const suffix = randomUUID().slice(0,8);
    await db.query('BEGIN');
    try {
      await db.query("insert into public.organizations(id,name,slug) values($1,'Johna parity CI',$2)", [org,`ci-johna-${suffix}`]);
      await db.query("insert into public.branches(id,name,organization_id) values($1,'CI Dining Branch',$2)", [branch,org]);
      await db.query("insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())",[owner,`ci-johna-${suffix}@test.invalid`]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query("insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Area Manager','super_admin',$3,true)",[owner,`ci-johna-${suffix}@test.invalid`,branch]);
      await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('app.register_branch','off',true)",[owner,JSON.stringify({sub:owner,role:'authenticated'})]);

      const create=async(name:string,count:number)=>{
        const {rows}=await db.query<{result:{success:boolean;error?:string;area_id?:string;table_count?:number}}>(
          'select public.floor_plan_create_area_with_tables($1::uuid,$2::text,$3::integer) result',[branch,name,count]);
        return rows[0].result;
      };
      const two=await create(`Terrace-${suffix}`,2);
      expect(two).toMatchObject({success:true,table_count:2});
      const {rows:tables}=await db.query<{name:string;branch_id:string;status:string}>(
        'select name,branch_id,status from public.dining_tables where area_id=$1 order by name',[two.area_id]);
      expect(tables).toHaveLength(2);
      expect(tables.every(x=>x.branch_id===branch && x.status==='vacant')).toBe(true);
      expect(tables.map(x=>x.name)).toEqual([`Terrace-${suffix} / Table 01`,`Terrace-${suffix} / Table 02`]);
      const empty=await create(`Empty-${suffix}`,0);
      expect(empty).toMatchObject({success:true,table_count:0});
      expect((await db.query('select count(*)::int n from public.dining_tables where area_id=$1',[empty.area_id])).rows[0].n).toBe(0);
      expect(await create(`Terrace-${suffix}`,1)).toMatchObject({success:false,error:'AREA_NAME_EXISTS'});
      expect(await create(`Too many-${suffix}`,101)).toMatchObject({success:false,error:'INVALID_AREA_TABLE_COUNT'});
      expect(await create(`Wrong branch-${suffix}`, -1)).toMatchObject({success:false,error:'INVALID_AREA_TABLE_COUNT'});
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('denies anonymous execution and uses invoker rights', async () => {
    const {rows}=await db.query<{prosecdef:boolean;anonymous:boolean}>(
      `select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anonymous
         from pg_proc p where p.oid='public.floor_plan_create_area_with_tables(uuid,text,integer)'::regprocedure`);
    expect(rows).toEqual([{prosecdef:false,anonymous:false}]);
  });
});
