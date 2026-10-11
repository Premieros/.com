import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required');

describe('ERP Phase 8C scheduled outbox and Phase 6 receiving regressions', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => db.connect());
  afterAll(async () => db.end());

  it('installs a bounded, postgres-owned worker whenever pg_cron is available', async () => {
    const { rows: [extension] } = await db.query<{
      available: boolean; installed: boolean; client_can_run: boolean; service_can_run: boolean;
    }>(
      "select exists(select 1 from pg_available_extensions where name='pg_cron') available, " +
      "exists(select 1 from pg_extension where extname='pg_cron') installed, " +
      "has_function_privilege('authenticated','private.process_erp_domain_outbox_batch_v2(text,integer)','EXECUTE') client_can_run, " +
      "has_function_privilege('service_role','private.process_erp_domain_outbox_batch_v2(text,integer)','EXECUTE') service_can_run",
    );
    expect(extension.client_can_run).toBe(false);
    expect(extension.service_can_run).toBe(false);
    if (extension.available) {
      expect(extension.installed).toBe(true);
      const { rows } = await db.query<{
        jobname: string; schedule: string; command: string; username: string; active: boolean;
      }>("select jobname,schedule,command,username,active from cron.job where jobname='erp-domain-outbox-v2'");
      expect(rows).toEqual([{
        jobname: 'erp-domain-outbox-v2',
        schedule: '* * * * *',
        command: "select private.process_erp_domain_outbox_batch_v2('erp-cron-v2',20);",
        username: 'postgres',
        active: true,
      }]);
    } else {
      // Local PostgreSQL CI does not bundle this optional Supabase extension.
      expect(extension.installed).toBe(false);
    }
  });

  it('enforces warehouse scope, exact purchase item provenance and cumulative received quantities', async () => {
    await db.query('BEGIN');
    try {
      const org = randomUUID(), branchA = randomUUID(), branchB = randomUUID();
      const warehouseA = randomUUID(), warehouseB = randomUUID();
      const productA = randomUUID(), productB = randomUUID();
      const purchaseA = randomUUID(), purchaseB = randomUUID();
      const itemA = randomUUID(), itemB = randomUUID();
      const receiptA = randomUUID(), receiptA2 = randomUUID();
      const secondLine = randomUUID();
      const unique = randomUUID().slice(0, 10);

      await db.query("insert into public.organizations(id,name) values($1,'CI 8C Scoped Org')", [org]);
      await db.query(
        "insert into public.branches(id,name,organization_id) values($1,'CI 8C Branch A',$3),($2,'CI 8C Branch B',$3)",
        [branchA,branchB,org],
      );
      await db.query(
        "insert into public.warehouses(id,name,branch_id) values($1,'CI 8C Warehouse A',$3),($2,'CI 8C Warehouse B',$4)",
        [warehouseA,warehouseB,branchA,branchB],
      );
      await db.query(
        "insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id) " +
        "values($1,'CI 8C Product A',$3,1,10,10,true,'ready',$5),($2,'CI 8C Product B',$4,1,10,10,true,'ready',$6)",
        [productA,productB,'CI8CA-'+unique,'CI8CB-'+unique,branchA,branchB],
      );
      await db.query(
        "insert into public.purchases(id,invoice_number,branch_id,status,total) " +
        "values($1,$3,$5,'draft',0),($2,$4,$6,'draft',0)",
        [purchaseA,purchaseB,'CI8CPA-'+unique,'CI8CPB-'+unique,branchA,branchB],
      );
      await db.query(
        "insert into public.purchase_items(id,purchase_id,product_id,quantity,unit_cost,total) " +
        "values($1,$3,$5,5,1,5),($2,$4,$6,5,1,5)",
        [itemA,itemB,purchaseA,purchaseB,productA,productB],
      );
      await db.query(
        "insert into public.purchase_receipts(id,receipt_number,purchase_id,branch_id,warehouse_id) " +
        "values($1,$3,$5,$7,$9),($2,$4,$5,$7,$9)",
        [receiptA,receiptA2,'CI8CRA-'+unique,'CI8CRA2-'+unique,purchaseA,purchaseB,branchA,branchB,warehouseA],
      );
      await db.query(
        'insert into public.purchase_receipt_items(receipt_id,purchase_item_id,quantity_received) values($1,$2,3)',
        [receiptA,itemA],
      );
      await db.query(
        'insert into public.purchase_receipt_items(id,receipt_id,purchase_item_id,quantity_received) values($1,$2,$3,2)',
        [secondLine,receiptA2,itemA],
      );

      await db.query('SAVEPOINT over_quantity');
      await expect(db.query(
        'insert into public.purchase_receipt_items(receipt_id,purchase_item_id,quantity_received) values($1,$2,1)',
        [receiptA2,itemA],
      )).rejects.toThrow(/PHASE6_RECEIPT_QUANTITY_EXCEEDS_ORDER/);
      await db.query('ROLLBACK TO SAVEPOINT over_quantity');

      await db.query('SAVEPOINT increased_quantity');
      await expect(db.query(
        'update public.purchase_receipt_items set quantity_received=3 where id=$1',
        [secondLine],
      )).rejects.toThrow(/PHASE6_RECEIPT_QUANTITY_EXCEEDS_ORDER/);
      await db.query('ROLLBACK TO SAVEPOINT increased_quantity');

      await db.query('SAVEPOINT wrong_item');
      await expect(db.query(
        'insert into public.purchase_receipt_items(receipt_id,purchase_item_id,quantity_received) values($1,$2,1)',
        [receiptA,itemB],
      )).rejects.toThrow(/PHASE6_RECEIPT_WRONG_PURCHASE_ITEM/);
      await db.query('ROLLBACK TO SAVEPOINT wrong_item');

      await db.query('SAVEPOINT wrong_warehouse');
      await expect(db.query(
        "insert into public.purchase_receipts(receipt_number,purchase_id,branch_id,warehouse_id) values($1,$2,$3,$4)",
        ['CI8CBAD-'+unique,purchaseA,branchA,warehouseB],
      )).rejects.toThrow(/PHASE6_RECEIPT_WAREHOUSE_BRANCH_MISMATCH/);
      await db.query('ROLLBACK TO SAVEPOINT wrong_warehouse');

      const { rows: [progress] } = await db.query<{
        documented_received_quantity: string; outstanding_documented_quantity: string;
        integrity_status: string;
      }>(
        'select documented_received_quantity::text,outstanding_documented_quantity::text,integrity_status ' +
        'from private.procurement_receipt_progress_v2 where purchase_item_id=$1', [itemA],
      );
      expect(progress.documented_received_quantity).toBe('5');
      expect(progress.outstanding_documented_quantity).toBe('0');
      expect(progress.integrity_status).toBe('LEDGER_RECEIPT_DIFFERENCE');

      const { rows: [events] } = await db.query<{ total: string }>(
        "select count(*)::text total from private.erp_domain_outbox_v2 where event_type='PURCHASE_RECEIPT_CREATED' " +
        'and aggregate_id=any($1::uuid[])', [[receiptA, receiptA2]],
      );
      expect(events.total).toBe('2');
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
