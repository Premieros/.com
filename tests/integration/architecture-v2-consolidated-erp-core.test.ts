import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Client } from 'pg';

const url=process.env.SUPABASE_DB_URL;
if(!url)throw new Error('SUPABASE_DB_URL required');

describe('Consolidated ERP accounting, procurement, domain outbox and agent context',()=>{
  const db=new Client({connectionString:url});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  const fixture=async()=>{
    const org=randomUUID(),branch=randomUUID();
    await db.query("insert into public.organizations(id,name) values($1,'CI Bundled ERP')",[org]);
    await db.query("insert into public.branches(id,name,organization_id) values($1,'CI Bundled Branch',$2)",[branch,org]);
    return {org,branch};
  };

  it('retains every historical journal UUID and debit/credit in immutable private evidence',async()=>{
    const {rows}=await db.query<{
      lines:string; evidence:string; unmatched:string; values_mismatch:string;
      rls:boolean; anon:boolean; auth:boolean; service:boolean;
    }>(`select
     (select count(*)::text from public.journal_entry_lines) lines,
     (select count(*)::text from private.organization_journal_line_evidence_v2) evidence,
     (select count(*)::text from public.journal_entry_lines l
       left join private.organization_journal_line_evidence_v2 e on e.journal_line_id=l.id
       where e.journal_line_id is null) unmatched,
     (select count(*)::text from public.journal_entry_lines l
       join private.organization_journal_line_evidence_v2 e on e.journal_line_id=l.id
       where l.account_id<>e.branch_account_id or l.journal_entry_id<>e.journal_entry_id
         or l.debit<>e.debit or l.credit<>e.credit) values_mismatch,
     (select relrowsecurity from pg_class where oid='private.organization_journal_line_evidence_v2'::regclass) rls,
     has_table_privilege('anon','private.organization_journal_line_evidence_v2','SELECT') anon,
     has_table_privilege('authenticated','private.organization_journal_line_evidence_v2','SELECT') auth,
     has_table_privilege('service_role','private.organization_journal_line_evidence_v2','UPDATE') service`);
    const r=rows[0];
    expect(r.lines).toBe(r.evidence);
    expect(r.unmatched).toBe('0');
    expect(r.values_mismatch).toBe('0');
    expect(r).toMatchObject({rls:true,anon:false,auth:false,service:false});
  });

  it('captures new ledger line snapshots and outbox events atomically without rewriting source',async()=>{
    await db.query('BEGIN');
    try{
      const {org,branch}=await fixture();
      const {rows:accounts}=await db.query<{id:string;code:string;name:string;name_en:string|null;account_type:string;is_system:boolean;is_active:boolean}>(
        'select id,code,name,name_en,account_type,is_system,is_active from public.chart_of_accounts where branch_id=$1 order by code limit 1',[branch]);
      expect(accounts.length).toBeGreaterThan(0);
      const a=accounts[0],id=randomUUID(),key='CI-'+randomUUID().slice(0,12);
      await db.query(
        "insert into public.journal_entries(id,entry_number,branch_id,entry_date,description) values($1,$2,$3,current_date,'CI ledger capture')",
        [id,key,branch]);
      const {rows:ev}=await db.query<{event_type:string;status:string}>(
        "select event_type,status from private.erp_domain_outbox_v2 where aggregate_id=$1",[id]);
      expect(ev).toEqual([{event_type:'JOURNAL_POSTED',status:'PENDING'}]);
      const {rows:lines}=await db.query<{id:string;account_id:string}>(
        `insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
         values($1,$2,20,0),($1,$2,0,20) returning id,account_id`,[id,a.id]);
      expect(lines).toHaveLength(2);
      const {rows:proof}=await db.query<{mapping_status:string;count:string;org_id:string}>(
        `select mapping_status,count(*)::text count,min(organization_id::text) org_id
         from private.organization_journal_line_evidence_v2 where journal_entry_id=$1
         group by mapping_status`,[id]);
      expect(proof).toEqual([{mapping_status:'UNMAPPED_AT_POSTING',count:'2',org_id:org}]);
      await db.query('SAVEPOINT immutable');
      await expect(db.query(
        "update private.organization_journal_line_evidence_v2 set debit=999 where journal_line_id=$1",[lines[0].id],
      )).rejects.toThrow(/PHASE5L_IMMUTABLE_LEDGER_EVIDENCE/);
      await db.query('ROLLBACK TO SAVEPOINT immutable');
    }finally{await db.query('ROLLBACK');}
  });

  it('publishes one event when a draft journal transitions to POSTED, without replay duplication',async()=>{
    await db.query('BEGIN');
    try{
      const {branch}=await fixture();
      const entryId=randomUUID();
      await db.query(
        "insert into public.journal_entries(id,entry_number,branch_id,posting_status) values($1,$2,$3,'DRAFT')",
        [entryId,'CI-DRAFT-'+randomUUID().slice(0,8),branch],
      );
      const count=async()=>{
        const {rows}=await db.query<{n:string}>(
          'select count(*)::text n from private.erp_domain_outbox_v2 where aggregate_id=$1',[entryId],
        );
        return rows[0].n;
      };
      expect(await count()).toBe('0');
      await db.query("update public.journal_entries set posting_status='POSTED' where id=$1",[entryId]);
      expect(await count()).toBe('1');
      await db.query("update public.journal_entries set posting_status='POSTED' where id=$1",[entryId]);
      expect(await count()).toBe('1');
    }finally{await db.query('ROLLBACK');}
  });

  it('refuses cross-purchase receipt scope and event queue privileges',async()=>{
    const {rows}=await db.query<{
      outbox_rls:boolean;private_outbox_read:boolean;private_outbox_write:boolean;
      worker_execute:boolean;anon_agent:boolean;auth_agent:boolean;service_agent:boolean;
    }>(`select
    (select relrowsecurity from pg_class where oid='private.erp_domain_outbox_v2'::regclass) outbox_rls,
    has_table_privilege('authenticated','private.erp_domain_outbox_v2','SELECT') private_outbox_read,
    has_table_privilege('service_role','private.erp_domain_outbox_v2','UPDATE') private_outbox_write,
    has_function_privilege('authenticated','private.claim_erp_domain_outbox_v2(text,integer)','EXECUTE') worker_execute,
    has_function_privilege('anon','public.get_erp_agent_readiness_context_v2(uuid)','EXECUTE') anon_agent,
    has_function_privilege('authenticated','public.get_erp_agent_readiness_context_v2(uuid)','EXECUTE') auth_agent,
    has_function_privilege('service_role','public.get_erp_agent_readiness_context_v2(uuid)','EXECUTE') service_agent`);
    expect(rows[0]).toEqual({
      outbox_rls:true,private_outbox_read:false,private_outbox_write:false,
      worker_execute:false,anon_agent:false,auth_agent:true,service_agent:false,
    });
    const {rows:context}=await db.query<{ctx:{success:boolean;error:string}}>(
      'select public.get_erp_agent_readiness_context_v2($1) ctx',[randomUUID()]);
    expect(context[0].ctx).toMatchObject({success:false,error:'AUTH_REQUIRED'});
  });

  it('blocks purchase receipts from a different branch in rollback, without writing events',async()=>{
    await db.query('BEGIN');
    try{
      const a=await fixture(),b=await fixture();
      const purchase=randomUUID();
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,status,total) values($1,$2,$3,'draft',0)",
        [purchase,'CI-PUR-'+randomUUID().slice(0,10),a.branch],
      );
      await db.query('SAVEPOINT crossbranch');
      await expect(db.query(
        "insert into public.purchase_receipts(receipt_number,purchase_id,branch_id) values($1,$2,$3)",
        ['CI-RCPT-'+randomUUID().slice(0,10),purchase,b.branch],
      )).rejects.toThrow(/PHASE6_RECEIPT_PURCHASE_BRANCH_MISMATCH/);
      await db.query('ROLLBACK TO SAVEPOINT crossbranch');
      const {rows:events}=await db.query<{count:string}>(
        "select count(*)::text count from private.erp_domain_outbox_v2 where event_type='PURCHASE_RECEIPT_CREATED' and organization_id=$1",[a.org]);
      expect(events[0].count).toBe('0');
      const receiptId=randomUUID();
      await db.query(
        'insert into public.purchase_receipts(id,receipt_number,purchase_id,branch_id) values($1,$2,$3,$4)',
        [receiptId,'CI-GOOD-RCPT-'+randomUUID().slice(0,10),purchase,a.branch],
      );
      const {rows:published}=await db.query<{event_type:string;event_key:string}>(
        'select event_type,event_key from private.erp_domain_outbox_v2 where aggregate_id=$1',[receiptId],
      );
      expect(published).toEqual([{
        event_type:'PURCHASE_RECEIPT_CREATED',event_key:`purchase.receipt:${receiptId}`,
      }]);
    }finally{await db.query('ROLLBACK');}
  });
});
