import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString=process.env.SUPABASE_DB_URL;
if(!connectionString)throw new Error('SUPABASE_DB_URL required');

describe('ERP Phase 8B verified internal outbox delivery',()=>{
  const db=new Client({connectionString});
  beforeAll(async()=>db.connect());
  afterAll(async()=>db.end());

  async function organization(){
    const org=randomUUID(),branch=randomUUID();
    await db.query("insert into public.organizations(id,name) values($1,'CI Consumer Org')",[org]);
    await db.query("insert into public.branches(id,name,organization_id) values($1,'CI Consumer Branch',$2)",[branch,org]);
    return {org,branch};
  }

  async function newJournal(branch:string,withLines:boolean){
    const id=randomUUID();
    await db.query(
      'insert into public.journal_entries(id,entry_number,branch_id) values($1,$2,$3)',
      [id,'CI-EVT-'+randomUUID().slice(0,12),branch],
    );
    const {rows:accounts}=await db.query<{id:string}>(
      'select id from public.chart_of_accounts where branch_id=$1 order by code limit 1',[branch]);
    if(!accounts[0])throw new Error('Journal fixture missing branch accounts');
    if(withLines)await db.query(
      `insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
       values($1,$2,10,0),($1,$2,0,10)`,[id,accounts[0].id],
    );
    return {id,accountId:accounts[0].id};
  }

  async function batch(){
    const {rows}=await db.query<{result:{claimed:number;delivered:number;failed:number}}> (
      "select private.process_erp_domain_outbox_batch_v2('ci-db-worker',20) result");
    return rows[0].result;
  }

  it('keeps delivery receipt and worker functions sealed from browser and service roles',async()=>{
    const {rows}=await db.query<{receipt_rls:boolean;anonymous_read:boolean;authenticated_read:boolean;
      service_write:boolean;authenticated_process:boolean;service_process:boolean;anon_retry:boolean}>(
      `select
      (select relrowsecurity from pg_class where oid='private.erp_domain_event_receipts_v2'::regclass) receipt_rls,
      has_table_privilege('anon','private.erp_domain_event_receipts_v2','SELECT') anonymous_read,
      has_table_privilege('authenticated','private.erp_domain_event_receipts_v2','SELECT') authenticated_read,
      has_table_privilege('service_role','private.erp_domain_event_receipts_v2','INSERT') service_write,
      has_function_privilege('authenticated','private.process_erp_domain_outbox_batch_v2(text,integer)','EXECUTE') authenticated_process,
      has_function_privilege('service_role','private.process_erp_domain_outbox_batch_v2(text,integer)','EXECUTE') service_process,
      has_function_privilege('anon','private.retry_failed_erp_domain_event_v2(uuid,text)','EXECUTE') anon_retry`);
    expect(rows[0]).toEqual({
      receipt_rls:true,anonymous_read:false,authenticated_read:false,service_write:false,
      authenticated_process:false,service_process:false,anon_retry:false,
    });
  });

  it('consumes balanced posted journal exactly once and persists immutable verified receipt',async()=>{
    await db.query('BEGIN');
    try{
      const {branch,org}=await organization();
      const j=await newJournal(branch,true);
      expect(await batch()).toMatchObject({claimed:1,delivered:1,failed:0});
      const {rows}=await db.query<{
        status:string;attempts:number;projection:{kind:string;lines:number;debits:number};
        event_key:string;receipt_org:string;
      }>(`select o.status,o.attempts,r.projection,o.event_key,r.organization_id::text receipt_org
          from private.erp_domain_outbox_v2 o
          join private.erp_domain_event_receipts_v2 r on r.event_id=o.id
          where o.aggregate_id=$1`,[j.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status:'DELIVERED',attempts:1,event_key:`journal.posted:${j.id}`,
        receipt_org:org,projection:{kind:'POSTED_JOURNAL_VERIFIED',lines:2,debits:10},
      });
      expect(await batch()).toMatchObject({claimed:0,delivered:0,failed:0});
      await db.query('SAVEPOINT immutable');
      await expect(db.query(
        'delete from private.erp_domain_event_receipts_v2 where event_key=$1',
        [`journal.posted:${j.id}`],
      )).rejects.toThrow(/PHASE8B_IMMUTABLE_DELIVERY_RECEIPT/);
      await db.query('ROLLBACK TO SAVEPOINT immutable');
    }finally{await db.query('ROLLBACK');}
  });

  it('isolates poison events, retries after the underlying journal is corrected, then delivers once',async()=>{
    await db.query('BEGIN');
    try{
      const {branch}=await organization();
      const bad=await newJournal(branch,false);
      const good=await newJournal(branch,true);
      expect(await batch()).toMatchObject({claimed:2,delivered:1,failed:1});
      const {rows:states}=await db.query<{aggregate_id:string;status:string;last_error:string}>(
        'select aggregate_id,status,last_error from private.erp_domain_outbox_v2 where aggregate_id=any($1::uuid[])',
        [[bad.id,good.id]],
      );
      expect(states.find(x=>x.aggregate_id===bad.id)?.status).toBe('FAILED');
      expect(states.find(x=>x.aggregate_id===bad.id)?.last_error).toContain('PHASE8B_JOURNAL_EVIDENCE_INVALID');
      expect(states.find(x=>x.aggregate_id===good.id)?.status).toBe('DELIVERED');
      await db.query(
        `insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
         values($1,$2,12,0),($1,$2,0,12)`,
        [bad.id,bad.accountId],
      );
      const {rows:retried}=await db.query<{ok:boolean}>(
        "select private.retry_failed_erp_domain_event_v2($1,'Source journal balanced and complete') ok",[(
          await db.query<{id:string}>('select id from private.erp_domain_outbox_v2 where aggregate_id=$1',[bad.id])
        ).rows[0].id]);
      expect(retried[0].ok).toBe(true);
      expect(await batch()).toMatchObject({claimed:1,delivered:1,failed:0});
      const {rows:counts}=await db.query<{n:string}>(
        'select count(*)::text n from private.erp_domain_event_receipts_v2 where aggregate_id=any($1::uuid[])',
        [[bad.id,good.id]]);
      expect(counts[0].n).toBe('2');
    }finally{await db.query('ROLLBACK');}
  });

  it('verifies purchase receipts against purchase scope and records quantity metadata',async()=>{
    await db.query('BEGIN');
    try{
      const {branch,org}=await organization();
      const purchaseId=randomUUID(),receiptId=randomUUID();
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,status,total) values($1,$2,$3,'draft',0)",
        [purchaseId,'CI-PO-'+randomUUID().slice(0,10),branch],
      );
      await db.query(
        'insert into public.purchase_receipts(id,receipt_number,purchase_id,branch_id) values($1,$2,$3,$4)',
        [receiptId,'CI-RCV-'+randomUUID().slice(0,10),purchaseId,branch],
      );
      expect(await batch()).toMatchObject({claimed:1,delivered:1,failed:0});
      const {rows}=await db.query<{
        organization_id:string;projection:{kind:string;receipt_item_count:number;purchase_id:string};
      }>(`select r.organization_id,r.projection from private.erp_domain_event_receipts_v2 r
        where r.aggregate_id=$1`,[receiptId]);
      expect(rows[0]).toMatchObject({
        organization_id:org,
        projection:{kind:'PURCHASE_RECEIPT_VERIFIED',purchase_id:purchaseId,receipt_item_count:0},
      });
    }finally{await db.query('ROLLBACK');}
  });
});
