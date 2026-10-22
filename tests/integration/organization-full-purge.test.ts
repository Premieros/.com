import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const conn=process.env.SUPABASE_DB_URL;
if (!conn) throw new Error('SUPABASE_DB_URL required');

describe('full tenant purge by independent Super Admin',()=>{
  const db=new Client({connectionString:conn});
  beforeAll(async()=>{await db.connect();});
  afterAll(async()=>{await db.end();});

  it('deletes a populated active organization while keeping other tenants and global Super Admin',async()=>{
    const [orgA,orgB,branchA,branchA2,branchB,ownerA,ownerB,adminId,staffA]=
      Array.from({length:9},()=>randomUUID());
    const suffix=randomUUID().slice(0,10);
    const name='CI Tenant purge '+suffix;
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.register_branch','on',true)");
      await db.query("INSERT INTO public.organizations(id,name,slug,is_active) VALUES($1,$2,$3,true),($4,$5,$6,true)",
        [orgA,name,'ci-delete-a-'+suffix,orgB,'CI Tenant keep '+suffix,'ci-delete-b-'+suffix]);
      await db.query("INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,'Branch A',$2,true),($3,'Branch A2',$2,true),($4,'Branch B',$5,true)",
        [branchA,orgA,branchA2,branchB,orgB]);
      for(const [id,role,home,mail] of [
        [ownerA,'owner',branchA,'ci-owner-a-'+suffix+'@example.invalid'],
        [ownerB,'owner',branchB,'ci-owner-b-'+suffix+'@example.invalid'],
        [adminId,'super_admin',branchB,'ci-sys-'+suffix+'@example.invalid'],
        [staffA,'cashier',branchA,'ci-staff-'+suffix+'@example.invalid']
      ]) {
        await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,mail]);
        await db.query("INSERT INTO public.users(id,email,full_name,username,role,branch_id,is_active) VALUES($1,$2,'CI Test User',$3,$4,$5,true)",
          [id,mail,'ci-user-'+id.slice(0,12),role,home]);
      }
      // A tenant-owned cashier has an old explicit access grant to the
      // other organization's branch. Purging the tenant must remove ONLY
      // this grant and cashier's identity, never that foreign branch.
      await db.query("INSERT INTO public.user_branch_access(user_id,branch_id) VALUES($1,$2)",
        [staffA,branchB]);
      const messageId=randomUUID(),conversationId=randomUUID();
      await db.query("INSERT INTO public.support_conversations(id,organization_id,branch_id,created_by,subject) VALUES($1,$2,$3,$4,'CI support ticket')",
        [conversationId,orgA,branchA,ownerA]);
      await db.query("INSERT INTO public.support_messages(id,conversation_id,sender_user_id,sender_kind,body) VALUES($1,$2,$3,'customer','CI question')",
        [messageId,conversationId,ownerA]);
      const baseline=await db.query<{total:string}>("SELECT COUNT(*)::text total FROM public.dining_tables WHERE branch_id=$1",[branchA]);
      expect(Number(baseline.rows[0].total)).toBeGreaterThan(0);
      const secondaryTables=await db.query<{total:string}>("SELECT count(*)::text total FROM public.dining_tables WHERE branch_id=$1",[branchA2]);
      expect(Number(secondaryTables.rows[0].total)).toBeGreaterThan(0);
      await db.query("SELECT set_config('app.user_id',$1,true)",[adminId]);

      // Reproduce real tenant: open table order with a sent kitchen item.
      const tableRes=await db.query<{id:string}>(
        "SELECT id FROM public.dining_tables WHERE branch_id=$1 ORDER BY name LIMIT 1",[branchA]);
      const orderId=randomUUID(),itemId=randomUUID(),productId=randomUUID();
      await db.query("INSERT INTO public.products(id,branch_id,name,sale_price) VALUES($1,$2,'CI meal',15)",
        [productId,branchA]);
      await db.query("INSERT INTO public.orders(id,order_number,branch_id,table_id,status,cashier_id) VALUES($1,$2,$3,$4,'open',$5)",
        [orderId,'CI-OPEN-'+suffix,branchA,tableRes.rows[0].id,ownerA]);
      await db.query("INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price,total) VALUES($1,$2,$3,2,15,30)",
        [itemId,orderId,productId]);
      await db.query("INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_by,sent_quantity) VALUES($1,$2,$3,$4,2)",
        [branchA,orderId,itemId,ownerA]);
      // Preserve a real-world unsettled kitchen inventory event; the purge
      // must remove it before the sent-item reduction guard runs.
      const warehouseId=randomUUID();
      await db.query("INSERT INTO public.warehouses(id,branch_id,name) VALUES($1,$2,'CI kitchen warehouse')",
        [warehouseId,branchA]);
      await db.query(`INSERT INTO public.order_kitchen_inventory_events(
          branch_id,warehouse_id,order_id,order_item_id,sent_quantity,created_by
        ) VALUES($1,$2,$3,$4,2,$5)`,
        [branchA,warehouseId,orderId,itemId,ownerA]);

      // Real incident: deleting employee customer while their credit sale
      // exists invokes sales_customer_id_fkey SET NULL, then
      // CREDIT_EMPLOYEE_ONLY rejects the UPDATE. Sale must be deleted first.
      const employeeA=randomUUID(), employeeB=randomUUID();
      const saleA=randomUUID(), saleB=randomUUID();
      await db.query("INSERT INTO public.customers(id,branch_id,name,customer_type) VALUES($1,$2,'CI credit employee A','employee'),($3,$4,'CI credit employee B','employee')",
        [employeeA,branchA,employeeB,branchB]);
      await db.query(`INSERT INTO public.sales(id,branch_id,invoice_number,customer_id,payment_method,total)
        VALUES($1,$2,$3,$4,'credit',15),($5,$6,$7,$8,'credit',15)`,
        [saleA,branchA,'CI-CREDIT-A-'+suffix,employeeA,
         saleB,branchB,'CI-CREDIT-B-'+suffix,employeeB]);
      // The normal trigger must still reject employee credit sales without a
      // customer. Revert the failed statement without aborting this test.
      await db.query('SAVEPOINT credit_guard_still_active');
      await expect(db.query('UPDATE public.sales SET customer_id=NULL WHERE id=$1',[saleA]))
        .rejects.toThrow(/CREDIT_EMPLOYEE_ONLY/);
      await db.query('ROLLBACK TO SAVEPOINT credit_guard_still_active');

      // Exercise raw FIFO settlement FK that blocked deletion of the real
      // organization's inventory_ledger. Both tenants must have debt and
      // receipt ledger rows; unrelated tenant's records must survive.
      const seedRawFifo = async (branchId:string, warehouse:string, tag:string) => {
        const materialId=randomUUID(),debtId=randomUUID();
        const negativeId=(-BigInt('0x'+randomUUID().replace(/-/g,'').slice(0,12))).toString();
        const negativeReceipt=(BigInt(negativeId)-1n).toString();
        await db.query(
          "INSERT INTO public.raw_materials(id,code,name,branch_id) VALUES($1,$2,$3,$4)",
          [materialId,'CI-FIFO-'+tag+'-'+suffix,'CI FIFO material',branchId]);
        await db.query(`INSERT INTO public.inventory_ledger(
          id,branch_id,warehouse_id,raw_material_id,quantity,unit_cost,total_cost,entry_type
        ) VALUES
          ($1,$3,$4,$5,-2,5,-10,'sale'),
          ($2,$3,$4,$5,2,5,10,'purchase')`,
          [negativeId,negativeReceipt,branchId,warehouse,materialId]);
        await db.query(`INSERT INTO public.raw_fifo_debts(
          id,branch_id,warehouse_id,raw_material_id,source_ledger_id,
          debt_quantity,source_created_at
        ) VALUES($1,$2,$3,$4,$5,2,now())`,
          [debtId,branchId,warehouse,materialId,negativeId]);
        const {rows}=await db.query<{id:string}>(`
          INSERT INTO public.raw_fifo_settlements(
            debt_id,receipt_ledger_id,quantity,unit_cost,total_cost
          ) VALUES ($1,$2,2,5,10) RETURNING id`,[debtId,negativeReceipt]);
        return { debtId,settlementId:rows[0].id,receipt:negativeReceipt };
      };
      const fifoA=await seedRawFifo(branchA,warehouseId,'A');
      const warehouseB=randomUUID();
      await db.query("INSERT INTO public.warehouses(id,branch_id,name) VALUES($1,$2,'CI other-tenant warehouse')",
        [warehouseB,branchB]);
      const fifoB=await seedRawFifo(branchB,warehouseB,'B');

      // Exercise actual immutable journal-line evidence (Phase 5L) and verified
      // ERP delivery receipts (Phase 8B), for both the target and kept tenant.
      const seedJournal = async (branch:string) => {
        const {rows} = await db.query<{id:string}>(
          'SELECT id FROM public.chart_of_accounts WHERE branch_id=$1 ORDER BY code LIMIT 1',[branch]);
        expect(rows.length).toBe(1);
        const id=randomUUID();
        await db.query('INSERT INTO public.journal_entries(id,entry_number,branch_id) VALUES($1,$2,$3)',
          [id,'CI-EVIDENCE-'+randomUUID().slice(0,11),branch]);
        await db.query(`INSERT INTO public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
          VALUES($1,$2,10,0),($1,$2,0,10)`,[id,rows[0].id]);
        return id;
      };
      const journalA=await seedJournal(branchA);
      const journalB=await seedJournal(branchB);
      const evidenceCount=async (journal:string) => {
        const {rows}=await db.query<{n:number}>(
          'SELECT count(*)::int n FROM private.organization_journal_line_evidence_v2 WHERE journal_entry_id=$1',
          [journal]);
        return rows[0].n;
      };
      expect(await evidenceCount(journalA)).toBe(2);
      expect(await evidenceCount(journalB)).toBe(2);

      const worker=await db.query<{v:{delivered:number}}>(
        "SELECT private.process_erp_domain_outbox_batch_v2('ci-purge-evidence',20) v");
      expect(worker.rows[0].v.delivered).toBeGreaterThanOrEqual(2);
      const receiptCount=async (journal:string) => {
        const {rows}=await db.query<{n:number}>(
          'SELECT count(*)::int n FROM private.erp_domain_event_receipts_v2 WHERE aggregate_id=$1',
          [journal]);
        return rows[0].n;
      };
      expect(await receiptCount(journalA)).toBe(1);
      expect(await receiptCount(journalB)).toBe(1);

      // Without the confirmed purge context, immutable accounting/audit
      // evidence remains untouchable, including by platform administrators.
      await db.query('SAVEPOINT protect_immutable_a');
      await expect(db.query(
        'DELETE FROM private.organization_journal_line_evidence_v2 WHERE journal_entry_id=$1',[journalA]
      )).rejects.toThrow(/PHASE5L_IMMUTABLE_LEDGER_EVIDENCE/);
      await db.query('ROLLBACK TO SAVEPOINT protect_immutable_a');
      await db.query('SAVEPOINT protect_immutable_receipt');
      await expect(db.query(
        'DELETE FROM private.erp_domain_event_receipts_v2 WHERE aggregate_id=$1',[journalA]
      )).rejects.toThrow(/PHASE8B_IMMUTABLE_DELIVERY_RECEIPT/);
      await db.query('ROLLBACK TO SAVEPOINT protect_immutable_receipt');

      const preview=await db.query<{result:{success:boolean;eligible:boolean;operational_documents:number;super_admins_preserved:number;blockers:unknown[]}}>(
        "SELECT public.super_admin_preview_organization_deletion($1) result",[orgA]);
      expect(preview.rows[0].result,JSON.stringify(preview.rows[0].result)).toMatchObject({
        success:true,eligible:true,blockers:[]
      });
      expect(preview.rows[0].result.operational_documents).toBeGreaterThanOrEqual(1);

      const wrong=await db.query<{result:{error:string}}>(
        "SELECT public.super_admin_delete_organization($1,'Wrong name','DELETE') result",[orgA]);
      expect(wrong.rows[0].result.error).toBe('ORGANIZATION_NAME_MISMATCH');

      const outcome=await db.query<{result:{success:boolean;deleted?:boolean;error?:string;auth_accounts_deleted?:number}}>(
        "SELECT public.super_admin_delete_organization($1,$2,'DELETE') result",[orgA,name]);
      expect(outcome.rows[0].result,JSON.stringify(outcome.rows[0].result)).toMatchObject({
        success:true,deleted:true,auth_accounts_deleted:2
      });

      const post=await db.query<{
        orgA:number;branchA:number;ownerA:number;authA:number;ticket:number;message:number;
        orgB:number;branchB:number;ownerB:number;authB:number;admin:number;adminAuth:number;
      }>(`SELECT
        (SELECT count(*)::int FROM public.organizations WHERE id=$1) "orgA",
        (SELECT count(*)::int FROM public.branches WHERE id=$2) "branchA",
        (SELECT count(*)::int FROM public.users WHERE id=$3) "ownerA",
        (SELECT count(*)::int FROM auth.users WHERE id=$3) "authA",
        (SELECT count(*)::int FROM public.support_conversations WHERE id=$4) ticket,
        (SELECT count(*)::int FROM public.support_messages WHERE id=$5) message,
        (SELECT count(*)::int FROM public.organizations WHERE id=$6) "orgB",
        (SELECT count(*)::int FROM public.branches WHERE id=$7) "branchB",
        (SELECT count(*)::int FROM public.users WHERE id=$8) "ownerB",
        (SELECT count(*)::int FROM auth.users WHERE id=$8) "authB",
        (SELECT count(*)::int FROM public.users WHERE id=$9 AND role='super_admin' AND branch_id IS NULL) admin,
        (SELECT count(*)::int FROM auth.users WHERE id=$9) "adminAuth"
      `,[orgA,branchA,ownerA,conversationId,messageId,orgB,branchB,ownerB,adminId]);
      expect(post.rows[0]).toMatchObject({
        orgA:0,branchA:0,ownerA:0,authA:0,ticket:0,message:0,
        orgB:1,branchB:1,ownerB:1,authB:1,admin:1,adminAuth:1,
      });
      const creditCheck=await db.query<{saleA:number;customerA:number;saleB:number;customerB:number}>(`
        SELECT (SELECT count(*)::int FROM public.sales WHERE id=$1) "saleA",
          (SELECT count(*)::int FROM public.customers WHERE id=$2) "customerA",
          (SELECT count(*)::int FROM public.sales WHERE id=$3) "saleB",
          (SELECT count(*)::int FROM public.customers WHERE id=$4) "customerB"
      `,[saleA,employeeA,saleB,employeeB]);
      expect(creditCheck.rows[0]).toEqual({saleA:0,customerA:0,saleB:1,customerB:1});
      const fifoCheck=await db.query<{debtA:number;settlementA:number;receiptA:number;
        debtB:number;settlementB:number;receiptB:number}>(`SELECT
        (SELECT count(*)::int FROM public.raw_fifo_debts WHERE id=$1) "debtA",
        (SELECT count(*)::int FROM public.raw_fifo_settlements WHERE id=$2) "settlementA",
        (SELECT count(*)::int FROM public.inventory_ledger WHERE id=$3) "receiptA",
        (SELECT count(*)::int FROM public.raw_fifo_debts WHERE id=$4) "debtB",
        (SELECT count(*)::int FROM public.raw_fifo_settlements WHERE id=$5) "settlementB",
        (SELECT count(*)::int FROM public.inventory_ledger WHERE id=$6) "receiptB"`,
        [fifoA.debtId,fifoA.settlementId,fifoA.receipt,
         fifoB.debtId,fifoB.settlementId,fifoB.receipt]);
      expect(fifoCheck.rows[0]).toEqual({debtA:0,settlementA:0,receiptA:0,
        debtB:1,settlementB:1,receiptB:1});
      expect(await evidenceCount(journalA)).toBe(0);
      expect(await receiptCount(journalA)).toBe(0);
      expect(await evidenceCount(journalB)).toBe(2);
      expect(await receiptCount(journalB)).toBe(1);
    } finally {await db.query('ROLLBACK');}
  });
});