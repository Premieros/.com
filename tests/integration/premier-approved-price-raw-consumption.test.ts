import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const connectionString=process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL required for warehouse raw consumption test');

describe('Phase 1 — approved-price consumption with warehouse-scoped quantities',()=>{
 const db=new Client({connectionString});
 beforeAll(async()=>db.connect());
 afterAll(async()=>db.end());
 it('decrements only its warehouse and posts the last approved price, including zero, not historic batch cost',async()=>{
   const org=randomUUID(),branch=randomUUID(),material=randomUUID(),warehouseA=randomUUID(),warehouseB=randomUUID();
   const batchA=randomUUID(),batchB=randomUUID(),label=randomUUID().slice(0,8);
   await db.query('BEGIN');
   try {
     await db.query("insert into public.organizations(id,name,slug) values($1,'CI Approved Consumption',$2)",[org,`ci-raw-consume-${label}`]);
     await db.query("insert into public.branches(id,name,organization_id) values($1,'CI Raw Consumption Branch',$2)",[branch,org]);
     await db.query(`insert into public.warehouses(id,branch_id,name,warehouse_type)
       values($1,$3,'A','raw'),($2,$3,'B','raw')`,[warehouseA,warehouseB,branch]);
     await db.query(`insert into public.raw_materials(id,branch_id,code,name,default_cost)
       values($1,$2,$3,'CI Material',999)`,[material,branch,`CI-CONS-${label}`]);
     await db.query(`insert into public.raw_material_batches(id,raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost)
       values($1,$3,$4,$5,'A-CI',10,90),($2,$3,$4,$6,'B-CI',20,140)`,[batchA,batchB,material,branch,warehouseA,warehouseB]);

     const consume=async(qty:number)=>{
       const {rows}=await db.query<{res:{success:boolean;removed:number;total_cost:number;avg_cost:number;shortage:number;warehouse_id:string}}>(
        `select public._raw_remove_fifo($1::uuid,$2::uuid,$3::uuid,$4::numeric,
           'production'::text,'ci_approved_cost'::text,NULL::uuid,NULL::text,NULL::uuid,false) res`,
        [material,branch,warehouseA,qty]);
       return rows[0].res;
     };
     // First approved price is 12, even though both historical batch costs differ.
     await db.query(`insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
       values($1,$2,12,'pricing',$3,'2026-11-14T00:00:00Z')`,[material,branch,`FIRST-${label}`]);
     const first=await consume(2);
     expect(first.success).toBe(true);
     expect(Number(first.removed)).toBe(2);
     expect(Number(first.total_cost)).toBe(24);
     expect(Number(first.avg_cost)).toBe(12);
     // Explicit approved zero supersedes earlier nonzero and historic batch prices.
     await db.query(`insert into public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
       values($1,$2,0,'pricing',$3,'2026-11-15T00:00:00Z')`,[material,branch,`ZERO-${label}`]);
     const zero=await consume(3);
     expect(zero.success).toBe(true);
     expect(Number(zero.total_cost)).toBe(0);
     expect(Number(zero.avg_cost)).toBe(0);
     expect(Number(zero.removed)).toBe(3);
     const {rows:batches}=await db.query<{id:string;quantity:string;unit_cost:string}>(
       `select id,quantity::text,unit_cost::text from public.raw_material_batches
        where id = any($1::uuid[]) order by id`,[[batchA,batchB]]);
     expect(Number(batches.find(x=>x.id===batchA)?.quantity)).toBe(5);
     expect(Number(batches.find(x=>x.id===batchB)?.quantity)).toBe(20);
     expect(Number(batches.find(x=>x.id===batchA)?.unit_cost)).toBe(90);
     expect(Number(batches.find(x=>x.id===batchB)?.unit_cost)).toBe(140);
     const {rows:ledgers}=await db.query<{quantity:string;unit_cost:string;total_cost:string;warehouse_id:string}>(
       `select quantity::text,unit_cost::text,total_cost::text,warehouse_id
        from public.inventory_ledger where raw_material_id=$1 and entry_type='production'
        order by created_at,id`,[material]);
     expect(ledgers).toHaveLength(2);
     expect(ledgers.map(x=>[Number(x.quantity),Number(x.unit_cost),Number(x.total_cost),x.warehouse_id]))
       .toEqual([[-2,12,-24,warehouseA],[-3,0,0,warehouseA]]);
   } finally {await db.query('ROLLBACK');}
 });
});
