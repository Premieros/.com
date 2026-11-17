import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error('SUPABASE_DB_URL required for isolated ZATCA schema tests');

describe('ZATCA private tenant-scoped persistence (CI disposable database only)', () => {
  const db = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });

  it('exposes no new ZATCA table to anonymous, authenticated or service roles', async () => {
    const names = ['zatca_branch_settings', 'zatca_egs_devices',
      'zatca_documents', 'zatca_submission_outbox'];
    const { rows } = await db.query<{
      name: string; rls: boolean; anon_read: boolean;
      auth_write: boolean; service_write: boolean;
    }>(`select c.relname as name, c.relrowsecurity rls,
        has_table_privilege('anon',c.oid,'SELECT') anon_read,
        has_table_privilege('authenticated',c.oid,'INSERT') auth_write,
        has_table_privilege('service_role',c.oid,'INSERT') service_write
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname = any($1::text[])
      order by c.relname`, [names]);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toMatchObject({
        rls: true, anon_read: false, auth_write: false, service_write: false,
      });
    }
  });

  it('enforces ownership across settings, device, invoice and outbox', async () => {
    const orgA = randomUUID(), orgB = randomUUID(), branchA = randomUUID();
    const settingsId = randomUUID(), deviceId = randomUUID(), documentId = randomUUID();
    const label = randomUUID().slice(0, 10);
    await db.query('BEGIN');
    try {
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'CI ZATCA A',$3),($2,'CI ZATCA B',$4)",
        [orgA, orgB, `ci-zatca-a-${label}`, `ci-zatca-b-${label}`],
      );
      await db.query(
        "insert into public.branches(id,name,organization_id) values($1,'CI ZATCA Branch',$2)",
        [branchA, orgA],
      );

      await db.query('SAVEPOINT wrong_org');
      await expect(db.query(`insert into private.zatca_branch_settings
        (id,organization_id,branch_id,environment)
        values($1,$2,$3,'sandbox')`, [randomUUID(),orgB,branchA]))
        .rejects.toThrow(/ZATCA_BRANCH_ORGANIZATION_MISMATCH/);
      await db.query('ROLLBACK TO SAVEPOINT wrong_org');

      await db.query(`insert into private.zatca_branch_settings
        (id,organization_id,branch_id,environment,vat_registration_number)
        values($1,$2,$3,'sandbox','300000000000003')`,
      [settingsId,orgA,branchA]);
      await db.query(`insert into private.zatca_egs_devices
        (id,settings_id,organization_id,branch_id,environment,device_code)
        values($1,$2,$3,$4,'sandbox','CI-EGS')`,
      [deviceId,settingsId,orgA,branchA]);

      await db.query('SAVEPOINT device_scope');
      await expect(db.query(`insert into private.zatca_egs_devices
        (settings_id,organization_id,branch_id,environment,device_code)
        values($1,$2,$3,'sandbox','CI-BAD')`,
      [settingsId,orgB,branchA])).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT device_scope');

      await db.query(`insert into private.zatca_documents
        (id,organization_id,branch_id,environment,egs_device_id,
         invoice_uuid,invoice_number,kind)
         values($1,$2,$3,'sandbox',$4,$5,'CI-ZATCA-01','simplified')`,
      [documentId,orgA,branchA,deviceId,randomUUID()]);

      await db.query(`insert into private.zatca_submission_outbox
        (document_id,organization_id,branch_id,environment,egs_device_id,channel)
        values($1,$2,$3,'sandbox',$4,'reporting')`,
      [documentId,orgA,branchA,deviceId]);

      await db.query('SAVEPOINT duplicate_action');
      await expect(db.query(`insert into private.zatca_submission_outbox
        (document_id,organization_id,branch_id,environment,egs_device_id,channel)
        values($1,$2,$3,'sandbox',$4,'reporting')`,
      [documentId,orgA,branchA,deviceId])).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT duplicate_action');

      await db.query('SAVEPOINT cross_tenant_outbox');
      await expect(db.query(`insert into private.zatca_submission_outbox
        (document_id,organization_id,branch_id,environment,egs_device_id,channel)
        values($1,$2,$3,'sandbox',$4,'clearance')`,
      [documentId,orgB,branchA,deviceId])).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT cross_tenant_outbox');

      await db.query("update private.zatca_documents set status='signed' where id=$1",[documentId]);
      await db.query('SAVEPOINT immutable_invoice');
      await expect(db.query(`update private.zatca_documents
        set invoice_number='TAMPER' where id=$1`,[documentId]))
        .rejects.toThrow(/ZATCA_ISSUED_DOCUMENT_IMMUTABLE/);
      await db.query('ROLLBACK TO SAVEPOINT immutable_invoice');

      await db.query('SAVEPOINT downgrade_doc');
      await expect(db.query("update private.zatca_documents set status='draft' where id=$1",
        [documentId])).rejects.toThrow(/ZATCA_DOCUMENT_STATUS_DOWNGRADE_FORBIDDEN/);
      await db.query('ROLLBACK TO SAVEPOINT downgrade_doc');

      await db.query('SAVEPOINT delete_doc');
      await expect(db.query('delete from private.zatca_documents where id=$1',
        [documentId])).rejects.toThrow(/ZATCA_DOCUMENT_DELETE_FORBIDDEN/);
      await db.query('ROLLBACK TO SAVEPOINT delete_doc');

      await db.query('SAVEPOINT wrong_outbox_transition');
      await expect(db.query(`update private.zatca_submission_outbox
        set state='accepted' where document_id=$1`,[documentId]))
        .rejects.toThrow(/ZATCA_OUTBOX_INVALID_TRANSITION/);
      await db.query('ROLLBACK TO SAVEPOINT wrong_outbox_transition');

      await db.query('SAVEPOINT delete_outbox');
      await expect(db.query('delete from private.zatca_submission_outbox where document_id=$1',
        [documentId])).rejects.toThrow(/ZATCA_OUTBOX_DELETE_FORBIDDEN/);
      await db.query('ROLLBACK TO SAVEPOINT delete_outbox');

      const { rows }=await db.query<{ state:string }>(`select state
        from private.zatca_submission_outbox where document_id=$1`,[documentId]);
      expect(rows).toEqual([{ state: 'queued' }]);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
