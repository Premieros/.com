import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const connectionString=process.env.SUPABASE_DB_URL;
if (!connectionString) throw Error('SUPABASE_DB_URL required');

describe('Cross-branch raw transfer source warehouse preflight',()=>{
 const db=new Client({connectionString});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});
 it('rejects an empty source, then moves stock once after replenishment',async()=>{
  const org=randomUUID(),sourceBranch=randomUUID(),destinationBranch=randomUUID();
  const sourceWarehouse=randomUUID(),otherWarehouse=randomUUID(),destinationWarehouse=randomUUID();
  const sourceMaterial=randomUUID(),destMaterial=randomUUID(),user=randomUUID(),transfer=randomUUID();
  const suffix=randomUUID().slice(0,8);
  await db.query('BEGIN');
  try{
   await db.query(`insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
    values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
    on conflict(role) do nothing`);
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI Transfer Preflight',$2)",[org,`ci-transfer-${suffix}`]);
   await db.query(`insert into public.branches(id,name,organization_id) values($1,'CI Source',$3),($2,'CI Destination',$3)`,[sourceBranch,destinationBranch,org]);
   await db.query(`insert into public.warehouses(id,branch_id,name,warehouse_type)
    values($1,$4,'Empty source','raw'),($2,$4,'Other stocked','raw'),($3,$5,'Destination','raw')`,
    [sourceWarehouse,otherWarehouse,destinationWarehouse,sourceBranch,destinationBranch]);
   await db.query(`insert into public.raw_materials(id,branch_id,code,name) values($1,$3,$4,'Source'),($2,$5,$6,'Destination')`,
    [sourceMaterial,destMaterial,sourceBranch,`CI-SRC-${suffix}`,destinationBranch,`CI-DST-${suffix}`]);
   await db.query(`insert into public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost)
    values($1,$2,$3,'CI-OTHER',9,4)`,[sourceMaterial,sourceBranch,otherWarehouse]);
   await db.query("insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())",[user,`ci-transfer-${suffix}@ci.invalid`]);
   await db.query("select set_config('app.register_branch','on',true)");
   await db.query(`insert into public.users(id,email,full_name,role,branch_id,is_active)
    values($1,$2,'CI Transfer Admin','super_admin',$3,true)`,[user,`ci-transfer-${suffix}@ci.invalid`,sourceBranch]);
   await db.query("select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",[user,JSON.stringify({sub:user,role:'authenticated'})]);
   await db.query(`insert into public.warehouse_transfers(id,transfer_number,from_warehouse_id,to_warehouse_id,branch_id,to_branch_id,status)
    values($1,$2,$3,$4,$5,$6,'pending')`,
    [transfer,`CI-TR-${suffix}`,sourceWarehouse,destinationWarehouse,sourceBranch,destinationBranch]);
   await db.query(`insert into public.warehouse_transfer_items(transfer_id,raw_material_id,destination_raw_material_id,quantity)
    values($1,$2,$3,3)`,[transfer,sourceMaterial,destMaterial]);

   const {rows}=await db.query<{result:{success:boolean;error:string;available:number;required:number}}>(
    'select public.approve_warehouse_transfer($1) result',[transfer]);
   expect(rows[0].result).toMatchObject({success:false,error:'INSUFFICIENT_RAW_STOCK'});
   expect(Number(rows[0].result.available)).toBe(0);
   expect(Number(rows[0].result.required)).toBe(3);
   const {rows:status}=await db.query<{status:string}>('select status from public.warehouse_transfers where id=$1',[transfer]);
   expect(status[0].status).toBe('pending');
   const {rows:stock}=await db.query<{qty:string}>(
    `select coalesce(sum(quantity),0)::text qty from public.raw_material_batches
     where branch_id=$1 and warehouse_id=$2 and raw_material_id=$3`,
    [sourceBranch,otherWarehouse,sourceMaterial]);
   expect(Number(stock[0].qty)).toBe(9);
   const { rows: [receipt] } = await db.query(
    `select private.apply_unified_raw_movement_v1(
      gen_random_uuid(),$1,$2,$3,5,'transfer','warehouse_transfer',$4,$5,$6,true
    ) result`,
    [sourceBranch,sourceWarehouse,sourceMaterial,randomUUID(),`CI-REPLENISH-${suffix}`,user]);
   expect(receipt.result).toMatchObject({success:true});
   const approve = () => db.query('select public.approve_warehouse_transfer($1) result',[transfer]);
   expect((await approve()).rows[0].result).toMatchObject({success:true});
   expect((await approve()).rows[0].result).toMatchObject({success:false});
   const { rows: balances } = await db.query(
    `select warehouse_id,sum(quantity)::text qty from public.raw_material_batches
      where (raw_material_id=$1 and warehouse_id in ($2,$3))
         or (raw_material_id=$4 and warehouse_id=$5)
      group by warehouse_id`,
    [sourceMaterial,sourceWarehouse,otherWarehouse,destMaterial,destinationWarehouse]);
   expect(Object.fromEntries(balances.map(row => [row.warehouse_id,Number(row.qty)])))
    .toEqual({[sourceWarehouse]:2,[otherWarehouse]:9,[destinationWarehouse]:3});
  }finally{await db.query('ROLLBACK');}
 });
});
