import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

const connectionString=process.env.SUPABASE_DB_URL;
if (!connectionString) throw Error('SUPABASE_DB_URL is required');

describe('Approved price for raw-material negative stock & debt settlement',()=>{
 const db=new Client({connectionString});
 beforeAll(async()=>{await db.connect();});
 afterAll(async()=>{await db.end();});

 it('records approved cost on negative consumption and never retrocharges it when a purchase settles stock',async()=>{
  const org=randomUUID(),branch=randomUUID(),material=randomUUID(),warehouse=randomUUID(),otherWarehouse=randomUUID();
  const id=randomUUID().slice(0,8);
  await db.query('BEGIN');
  try {
   await db.query("insert into public.organizations(id,name,slug) values($1,'CI Raw Negative',$2)",[org,`ci-negative-${id}`]);
   await db.query("insert into public.branches(id,name,organization_id) values($1,'CI Raw Negative Branch',$2)",[branch,org]);
   await db.query(`insert into public.warehouses(id,branch_id,name,warehouse_type) values($1,$3,'Negative A','raw'),($2,$3,'Negative B','raw')`,[warehouse,otherWarehouse,branch]);
   await db.query(`insert into public.raw_materials(id,branch_id,code,name,default_cost) values($1,$2,$3,'CI Material',888)`,[material,branch,`CI-NEG-${id}`]);
   await db.query(`insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
       values($1,$2,16,'pricing',$3,'2026-11-14T00:00:00Z')`,[material,branch,`APPROVED-${id}`]);

   const consume=async(qty:number)=>{
    const {rows}=await db.query<{result:{success:boolean;removed:number;total_cost:number;oversold:number;warehouse_id:string}}>(
      `select public._raw_remove_fifo($1::uuid,$2::uuid,$3::uuid,$4::numeric,
         'production'::text,'ci_negative_approved'::text,NULL::uuid,NULL::text,NULL::uuid,true) result`,
      [material,branch,warehouse,qty]);
    return rows[0].result;
   };
   const neg=await consume(3);
   expect(neg.success).toBe(true);
   expect(Number(neg.oversold)).toBe(3);
   expect(Number(neg.removed)).toBe(3);
   expect(Number(neg.total_cost)).toBe(48);
   const {rows:debts}=await db.query<{id:string;source_ledger_id:string;cost_policy:string;oversold_batch_id:string}>(
       'select id,source_ledger_id::text,cost_policy,oversold_batch_id from public.raw_fifo_debts where raw_material_id=$1',[material]);
   expect(debts).toHaveLength(1);
   expect(debts[0].cost_policy).toBe('approved_price');
   const sourceId=debts[0].source_ledger_id;
   const {rows:source}=await db.query<{unit_cost:string;total_cost:string;quantity:string}>(
      'select unit_cost::text,total_cost::text,quantity::text from public.inventory_ledger where id=$1',[sourceId]);
   expect([Number(source[0].unit_cost),Number(source[0].total_cost),Number(source[0].quantity)]).toEqual([16,-48,-3]);
   const {rows:shortage}=await db.query<{unit_cost:string;quantity:string}>(
      'select unit_cost::text,quantity::text from public.raw_material_batches where id=$1',[debts[0].oversold_batch_id]);
   expect(Number(shortage[0].unit_cost)).toBe(16);
   expect(Number(shortage[0].quantity)).toBe(-3);

   // Receiving stock may settle negative physical quantity but must never
   // mutate the cost of the already recorded approved-price consumption.
   const {rows:receipt}=await db.query<{result:{success:boolean;fifo_settled_quantity:number;fifo_settled_value:number}}>(
     `select public._raw_add($1::uuid,$2::uuid,$3::uuid,3::numeric,99::numeric,
       'CI-RECEIPT'::text,NULL::date,NULL::date,'purchase'::text,
       'ci_purchase'::text,NULL::uuid,NULL::text,NULL::uuid) result`,
      [material,branch,warehouse]);
   expect(receipt[0].result.success).toBe(true);
   expect(Number(receipt[0].result.fifo_settled_quantity)).toBe(3);
   expect(Number(receipt[0].result.fifo_settled_value)).toBe(0);
   const {rows:after}=await db.query<{unit_cost:string;total_cost:string}>(
     'select unit_cost::text,total_cost::text from public.inventory_ledger where id=$1',[sourceId]);
   expect([Number(after[0].unit_cost),Number(after[0].total_cost)]).toEqual([16,-48]);
   const {rows:settlements}=await db.query<{total_cost:string}>(
     'select total_cost::text from public.raw_fifo_settlements where debt_id=$1',[debts[0].id]);
   expect(settlements).toHaveLength(1);
   expect(Number(settlements[0].total_cost)).toBe(0);
   const {rows:balance}=await db.query<{qty:string}>(
     `select coalesce(sum(quantity),0)::text qty from public.raw_material_batches
       where raw_material_id=$1 and branch_id=$2 and warehouse_id=$3`,[material,branch,otherWarehouse]);
   expect(Number(balance[0].qty)).toBe(0);

   // A later explicitly approved zero supersedes prior 16, even on new debts.
   await db.query(`insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
        values($1,$2,0,'pricing',$3,'2026-11-15T00:00:00Z')`,[material,branch,`ZERO-${id}`]);
   const zero=await consume(2);
   expect(zero.success).toBe(true);
   expect(Number(zero.total_cost)).toBe(0);
   const {rows:latest}=await db.query<{unit_cost:string;total_cost:string}>(
     `select l.unit_cost::text,l.total_cost::text from public.inventory_ledger l
      where l.raw_material_id=$1 and l.quantity=-2 and l.entry_type='production'
      order by id desc limit 1`,[material]);
   expect([Number(latest[0].unit_cost),Number(latest[0].total_cost)]).toEqual([0,0]);
  } finally { await db.query('ROLLBACK'); }
 });
});
