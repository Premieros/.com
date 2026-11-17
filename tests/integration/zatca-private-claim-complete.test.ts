import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error('SUPABASE_DB_URL required for isolated ZATCA claim tests');

describe('ZATCA private sandbox claim/fenced completion (disposable database)', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => db.connect());
  afterAll(async () => db.end());

  it('keeps all claim/completion procedures inaccessible to browser/service roles', async () => {
    const { rows } = await db.query<{
      anon_claim: boolean; auth_claim: boolean; service_claim: boolean;
      anon_complete: boolean; auth_complete: boolean; service_complete: boolean;
    }>(`select
      has_function_privilege('anon','private.zatca_claim_queued_v1(uuid)','EXECUTE') anon_claim,
      has_function_privilege('authenticated','private.zatca_claim_queued_v1(uuid)','EXECUTE') auth_claim,
      has_function_privilege('service_role','private.zatca_claim_queued_v1(uuid)','EXECUTE') service_claim,
      has_function_privilege('anon','private.zatca_complete_claim_v1(uuid,uuid,text,integer,text)','EXECUTE') anon_complete,
      has_function_privilege('authenticated','private.zatca_complete_claim_v1(uuid,uuid,text,integer,text)','EXECUTE') auth_complete,
      has_function_privilege('service_role','private.zatca_complete_claim_v1(uuid,uuid,text,integer,text)','EXECUTE') service_complete`);
    expect(rows[0]).toEqual({
      anon_claim: false, auth_claim: false, service_claim: false,
      anon_complete: false, auth_complete: false, service_complete: false,
    });
  });

  it('claims once, updates the correct invoice and rejects stale fence or duplicate replay', async () => {
    const org = randomUUID(), branch = randomUUID(), settings = randomUUID();
    const device = randomUUID(), doc = randomUUID(), event = randomUUID();
    const label = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(`insert into public.organizations(id,name,slug)
        values($1,'CI ZATCA Claim Org',$2)`,[org,`ci-zatca-claim-${label}`]);
      await db.query(`insert into public.branches(id,name,organization_id)
        values($1,'CI ZATCA Claim Branch',$2)`,[branch,org]);
      await db.query(`insert into private.zatca_branch_settings
        (id,organization_id,branch_id,environment,enabled,onboarding_complete,compliance_tested)
        values($1,$2,$3,'sandbox',true,true,true)`,[settings,org,branch]);
      await db.query(`insert into private.zatca_egs_devices
        (id,settings_id,organization_id,branch_id,environment,device_code,
          credential_vault_reference,status)
        values($1,$2,$3,$4,'sandbox','CI-EGS','vault:demo/ci','ready')`,
      [device,settings,org,branch]);
      await db.query(`insert into private.zatca_documents
        (id,organization_id,branch_id,environment,egs_device_id,
          invoice_uuid,invoice_number,kind,status,issued_at,invoice_hash,
          signed_xml_vault_reference,invoice_counter)
        values($1,$2,$3,'sandbox',$4,$5,'CI-100','simplified',
          'issued_pending_reporting',now(),'fake-hash','vault:ci/xml',1)`,
      [doc,org,branch,device,randomUUID()]);
      await db.query(`insert into private.zatca_submission_outbox
        (id,document_id,organization_id,branch_id,environment,egs_device_id,channel)
        values($1,$2,$3,$4,'sandbox',$5,'reporting')`,
      [event,doc,org,branch,device]);

      const claim = await db.query<{event_id:string;fence_token:string}>(`
        select * from private.zatca_claim_queued_v1($1)`,[event]);
      expect(claim.rows).toHaveLength(1);
      expect(claim.rows[0].event_id).toBe(event);
      const fence = claim.rows[0].fence_token;
      expect(fence).toMatch(/^[0-9a-f-]{36}$/);
      expect((await db.query(`select * from private.zatca_claim_queued_v1($1)`,[event]))
        .rows).toHaveLength(0);

      await db.query('SAVEPOINT wrong_fence');
      await expect(db.query(`select private.zatca_complete_claim_v1(
        $1,$2,'accepted',200,null)`,[event,randomUUID()]))
        .rejects.toThrow(/ZATCA_OUTBOX_FENCE_MISMATCH/);
      await db.query('ROLLBACK TO SAVEPOINT wrong_fence');

      const completed = await db.query<{result:boolean}>(`
        select private.zatca_complete_claim_v1($1,$2,'accepted',200,null) as result`,
      [event,fence]);
      expect(completed.rows[0].result).toBe(true);
      const result = await db.query<{state:string;attempt_count:number;status:string}>(`
        select o.state,o.attempt_count,d.status
          from private.zatca_submission_outbox o
          join private.zatca_documents d on d.id=o.document_id where o.id=$1`,[event]);
      expect(result.rows[0]).toEqual({ state:'accepted', attempt_count:1,status:'reported' });

      await db.query('SAVEPOINT duplicate_complete');
      await expect(db.query(`select private.zatca_complete_claim_v1(
        $1,$2,'accepted',200,null)`,[event,fence]))
        .rejects.toThrow(/ZATCA_OUTBOX_FENCE_MISMATCH/);
      await db.query('ROLLBACK TO SAVEPOINT duplicate_complete');
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('does not let unconfigured or production jobs bypass the sandbox-only rollout gate', async () => {
    const org = randomUUID(), branch = randomUUID(), settings = randomUUID();
    const device = randomUUID(), doc = randomUUID(), event = randomUUID();
    const label = randomUUID().slice(0, 8);
    await db.query('BEGIN');
    try {
      await db.query(`insert into public.organizations(id,name,slug)
        values($1,'CI ZATCA Disabled Org',$2)`,[org,`ci-zatca-disabled-${label}`]);
      await db.query(`insert into public.branches(id,name,organization_id)
        values($1,'CI Disabled Branch',$2)`,[branch,org]);
      await db.query(`insert into private.zatca_branch_settings
        (id,organization_id,branch_id,environment,enabled,onboarding_complete,compliance_tested)
        values($1,$2,$3,'production',false,true,true)`,[settings,org,branch]);
      await db.query(`insert into private.zatca_egs_devices
        (id,settings_id,organization_id,branch_id,environment,device_code,
         credential_vault_reference,status)
        values($1,$2,$3,$4,'production','CI-EGS-2','vault:ci','ready')`,
      [device,settings,org,branch]);
      await db.query(`insert into private.zatca_documents
        (id,organization_id,branch_id,environment,egs_device_id,
          invoice_uuid,invoice_number,kind,status,issued_at,invoice_hash,
          signed_xml_vault_reference,invoice_counter)
        values($1,$2,$3,'production',$4,$5,'CI-200','standard',
          'signed',now(),'hash','vault:ci/xml',1)`,
      [doc,org,branch,device,randomUUID()]);
      await db.query(`insert into private.zatca_submission_outbox
        (id,document_id,organization_id,branch_id,environment,egs_device_id,channel)
        values($1,$2,$3,$4,'production',$5,'clearance')`,
      [event,doc,org,branch,device]);
      expect((await db.query('select * from private.zatca_claim_queued_v1($1)',
        [event])).rows).toHaveLength(0);
      const status=await db.query<{state:string;attempt_count:number}>(`
        select state,attempt_count from private.zatca_submission_outbox where id=$1`,[event]);
      expect(status.rows[0]).toEqual({ state:'queued',attempt_count:0 });
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
