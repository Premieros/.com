import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required');

type Rpc = { success?: boolean; error?: string; detail?: string; purchase_id?: string;
  status?: string; receipt_id?: string; fully_received?: boolean; items_received?: number };

describe('Procurement receipt: real RPC order-to-inventory and accounting lifecycle', () => {
  const db = new Client({ connectionString: url });
  beforeAll(async () => db.connect());
  afterAll(async () => db.end());

  it('posts partial and final GRNs exactly once and rejects over-receipt/replay without stock or journal drift', async () => {
    // All fixtures and all RPC side effects are rolled back in disposable CI PostgreSQL.
    await db.query('BEGIN');
    try {
      const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
      const user = randomUUID(), unit = randomUUID(), raw = randomUUID();
      const product = randomUUID(), supplier = randomUUID();
      const token = randomUUID().replace(/-/g, '').slice(0, 12);
      const json = async (query: string, args: unknown[] = []) => {
        const { rows } = await db.query<{ result: Rpc }>(query, args);
        return rows[0].result;
      };

      await db.query(
        "insert into public.roles(role,name_ar,name_en,permissions,scope,is_active) values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) on conflict(role) do nothing",
      );
      await db.query('insert into public.organizations(id,name,slug) values($1,$2,$3)',
        [org,'CI Procurement Lifecycle','ci-receive-'+token]);
      await db.query('insert into public.branches(id,name,organization_id,is_active) values($1,$2,$3,true)',
        [branch,'CI Receipt Branch '+token,org]);
      const email = 'receipt-'+token+'@ci.invalid';
      await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',
        [user,email]);
      await db.query("select set_config('app.register_branch','on',true)");
      await db.query(
        "insert into public.users(id,email,full_name,role,branch_id,is_active) values($1,$2,'CI Receipt Operator','super_admin',$3,true)",
        [user,email,branch]);
      await db.query(
        "select set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [user,JSON.stringify({ sub:user, role:'authenticated' })]);
      await db.query(
        "insert into public.warehouses(id,name,branch_id,is_active,is_default) values($1,'CI Receipt Warehouse',$2,true,true)",
        [warehouse,branch]);
      await db.query('select public.seed_account_mappings($1)',[branch]);
      await db.query(
        "insert into public.measurement_units(id,code,name,symbol,is_active) values($1,$2,'CI Unit','u',true)",
        [unit,'CIRU-'+token]);
      await db.query(
        "insert into public.raw_materials(id,code,name,unit_id,branch_id,default_cost,is_active) values($1,$2,'CI Receipt Raw',$3,$4,5,true)",
        [raw,'CIRR-'+token,unit,branch]);
      await db.query(
        "insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id) values($1,'CI Receipt Product',$2,10,20,20,true,'ready',$3)",
        [product,'CIRP-'+token,branch]);
      await db.query(
        "insert into public.suppliers(id,name,branch_id) values($1,$2,$3)",
        [supplier,'CI Receipt Supplier '+token,branch]);

      const orderLines = [
        { product_id:product, unit_name:'piece', quantity:4, unit_cost:10 },
        { raw_material_id:raw, unit_name:'u', quantity:3, unit_cost:5 },
      ];
      const order = await json(
        "select public.create_purchase_order($1,$2,$3,'credit','CI receipt integration test',$4::jsonb,null) result",
        [branch,supplier,warehouse,JSON.stringify(orderLines)]);
      expect(order.success,JSON.stringify(order)).toBe(true);
      const poId = String(order.purchase_id);
      const { rows: purchaseItems } = await db.query<{ id:string; product_id:string|null; raw_material_id:string|null }>(
        'select id,product_id,raw_material_id from public.purchase_items where purchase_id=$1',[poId]);
      expect(purchaseItems).toHaveLength(2);
      const productLine = purchaseItems.find(x => x.product_id===product)?.id;
      const rawLine = purchaseItems.find(x => x.raw_material_id===raw)?.id;
      expect(productLine).toBeTruthy();
      expect(rawLine).toBeTruthy();

      const original = await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [poId,JSON.stringify([{purchase_item_id:productLine,quantity_received:1}])]);
      expect(original).toMatchObject({success:false,error:'NOT_RECEIVABLE'});

      for(const status of ['submitted','approved']){
        const transition = await json(
          'select public.update_purchase_order_status($1,$2) result',[poId,status]);
        expect(transition,JSON.stringify(transition)).toMatchObject({success:true,status});
      }
      const first = await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [poId,JSON.stringify([
          {purchase_item_id:productLine,quantity_received:2},
          {purchase_item_id:rawLine,quantity_received:1},
        ])]);
      expect(first,JSON.stringify(first)).toMatchObject({success:true,fully_received:false,status:'partial',items_received:2});

      const { rows: [partial] } = await db.query<{
        status:string; product_stock:string; raw_stock:string; posted_journals:string;
      }>(
        "select (select status from public.purchases where id=$1) status, " +
        "(select coalesce(sum(quantity),0)::text from public.inventory where product_id=$2 and warehouse_id=$4) product_stock, " +
        "(select coalesce(sum(quantity),0)::text from public.raw_material_inventory where raw_material_id=$3 and branch_id=$5) raw_stock, " +
        "(select count(*)::text from public.journal_entries where reference_id=$1 and reference_type='purchase') posted_journals",
        [poId,product,raw,warehouse,branch]);
      expect(partial.status).toBe('partial');
      expect(Number(partial.product_stock)).toBe(2);
      expect(Number(partial.raw_stock)).toBe(1);
      expect(partial.posted_journals).toBe('0');

      const attemptedOverReceipt = await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [poId,JSON.stringify([{purchase_item_id:productLine,quantity_received:3}])]);
      expect(attemptedOverReceipt).toMatchObject({success:false,error:'OVER_RECEIPT'});
      const { rows: [unchanged] } = await db.query<{ count:string }>(
        'select count(*)::text count from public.purchase_receipts where purchase_id=$1',[poId]);
      expect(unchanged.count).toBe('1');

      const finalReceipt = await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [poId,JSON.stringify([
          {purchase_item_id:productLine,quantity_received:2},
          {purchase_item_id:rawLine,quantity_received:2},
        ])]);
      expect(finalReceipt,JSON.stringify(finalReceipt)).toMatchObject({
        success:true,fully_received:true,status:'completed',items_received:2,
      });

      const { rows: [snapshot] } = await db.query<{
        po_status:string; product_stock:string; raw_stock:string; receipts:string;
        receipt_lines:string; journal_count:string; debit:string; credit:string;
        outstanding:string; inconsistent_lines:string; event_count:string;
      }>(
        "select (select status from public.purchases where id=$1) po_status, " +
        "(select coalesce(sum(quantity),0)::text from public.inventory where product_id=$2 and warehouse_id=$4) product_stock, " +
        "(select coalesce(sum(quantity),0)::text from public.raw_material_inventory where raw_material_id=$3 and branch_id=$5) raw_stock, " +
        "(select count(*)::text from public.purchase_receipts where purchase_id=$1) receipts, " +
        "(select count(*)::text from public.purchase_receipt_items ri join public.purchase_receipts r on r.id=ri.receipt_id where r.purchase_id=$1) receipt_lines, " +
        "(select count(*)::text from public.journal_entries where reference_type='purchase' and reference_id=$1) journal_count, " +
        "(select coalesce(sum(l.debit),0)::text from public.journal_entry_lines l join public.journal_entries j on j.id=l.journal_entry_id where j.reference_type='purchase' and j.reference_id=$1) debit, " +
        "(select coalesce(sum(l.credit),0)::text from public.journal_entry_lines l join public.journal_entries j on j.id=l.journal_entry_id where j.reference_type='purchase' and j.reference_id=$1) credit, " +
        "(select coalesce(sum(outstanding_documented_quantity),0)::text from private.procurement_receipt_progress_v2 where purchase_id=$1) outstanding, " +
        "(select count(*)::text from private.procurement_receipt_progress_v2 where purchase_id=$1 and integrity_status<>'CONSISTENT') inconsistent_lines, " +
        "(select count(*)::text from private.erp_domain_outbox_v2 e join public.purchase_receipts r on r.id=e.aggregate_id where r.purchase_id=$1 and e.event_type='PURCHASE_RECEIPT_CREATED') event_count",
        [poId,product,raw,warehouse,branch]);
      expect(snapshot.po_status).toBe('completed');
      expect(Number(snapshot.product_stock)).toBe(4);
      expect(Number(snapshot.raw_stock)).toBe(3);
      expect(snapshot.receipts).toBe('2');
      expect(snapshot.receipt_lines).toBe('4');
      expect(snapshot.journal_count).toBe('1');
      expect(Number(snapshot.debit)).toBe(55);
      expect(Number(snapshot.credit)).toBe(55);
      expect(Number(snapshot.outstanding)).toBe(0);
      expect(snapshot.inconsistent_lines).toBe('0');
      expect(snapshot.event_count).toBe('2');

      // Re-delivery of the same GRN request cannot double-post stock or finance.
      const retry = await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [poId,JSON.stringify([{purchase_item_id:productLine,quantity_received:2}])]);
      expect(retry).toMatchObject({success:false,error:'NOT_RECEIVABLE'});
      const { rows: [afterRetry] } = await db.query<{ count:string; posting_count:string }>(
        "select (select count(*)::text from public.purchase_receipts where purchase_id=$1) count, " +
        "(select count(*)::text from public.journal_entries where reference_type='purchase' and reference_id=$1) posting_count",
        [poId]);
      expect(afterRetry).toEqual({count:'2',posting_count:'1'});

      // Fault injection: a legacy purchase item that changed its purchase unit
      // between PO approval and receipt. The product line would add stock
      // successfully, and the second (raw) line fails UOM normalization.
      // The entire receipt must rollback, including the FIRST line, GRN and
      // emitted outbox event, rather than returning a JSON failure after writes.
      const failOrder = await json(
        "select public.create_purchase_order($1,$2,$3,'credit','CI atomic receipt failure',$4::jsonb,null) result",
        [branch,supplier,warehouse,JSON.stringify([
          {product_id:product,unit_name:'piece',quantity:1,unit_cost:10},
          {raw_material_id:raw,unit_name:'u',quantity:1,unit_cost:5},
        ])]);
      expect(failOrder.success,JSON.stringify(failOrder)).toBe(true);
      const failPoId = String(failOrder.purchase_id);
      const { rows: failLines } = await db.query<{id:string;product_id:string|null;raw_material_id:string|null}>(
        'select id,product_id,raw_material_id from public.purchase_items where purchase_id=$1',[failPoId]);
      const failProductLine = failLines.find(x=>x.product_id===product)?.id;
      const failRawLine = failLines.find(x=>x.raw_material_id===raw)?.id;
      expect(failProductLine).toBeTruthy();
      expect(failRawLine).toBeTruthy();
      for(const status of ['submitted','approved']){
        const next=await json('select public.update_purchase_order_status($1,$2) result',[failPoId,status]);
        expect(next,JSON.stringify(next)).toMatchObject({success:true,status});
      }
      await db.query("update public.purchase_items set unit_name='kg' where id=$1",[failRawLine]);

      const failedReceipt=await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [failPoId,JSON.stringify([
          {purchase_item_id:failProductLine,quantity_received:1},
          {purchase_item_id:failRawLine,quantity_received:1},
        ])]);
      expect(failedReceipt.success).toBe(false);
      expect(failedReceipt.detail).toContain('PURCHASE_RECEIPT_STOCK_FAILED');
      expect(failedReceipt.detail).toContain('INCOMPATIBLE_PURCHASE_UNIT');

      const { rows:[failedState] } = await db.query<{
        receipts:string; received:string; product_qty:string; raw_qty:string;
        posted_journals:string; outbox_events:string; status:string;
      }>(
        "select (select count(*)::text from public.purchase_receipts where purchase_id=$1) receipts, " +
        "(select coalesce(sum(received_quantity),0)::text from public.purchase_items where purchase_id=$1) received, " +
        "(select coalesce(sum(quantity),0)::text from public.inventory where product_id=$2 and warehouse_id=$4) product_qty, " +
        "(select coalesce(sum(quantity),0)::text from public.raw_material_inventory where raw_material_id=$3 and branch_id=$5) raw_qty, " +
        "(select count(*)::text from public.journal_entries where reference_type='purchase' and reference_id=$1) posted_journals, " +
        "(select count(*)::text from private.erp_domain_outbox_v2 e join public.purchase_receipts r on r.id=e.aggregate_id where r.purchase_id=$1 and e.event_type='PURCHASE_RECEIPT_CREATED') outbox_events, " +
        "(select status from public.purchases where id=$1) status",
        [failPoId,product,raw,warehouse,branch]);
      expect({
        ...failedState,
        received:Number(failedState.received),
        product_qty:Number(failedState.product_qty),
        raw_qty:Number(failedState.raw_qty),
      }).toEqual({
        receipts:'0',received:0,product_qty:4,raw_qty:3,
        posted_journals:'0',outbox_events:'0',status:'approved',
      });

      // Recovery after fixing the offending line uses the existing RPC; no
      // ghost receipt or stock was left from the failed attempt.
      await db.query("update public.purchase_items set unit_name='u' where id=$1",[failRawLine]);
      const recovered=await json(
        'select public.receive_purchase_order($1,$2::jsonb) result',
        [failPoId,JSON.stringify([
          {purchase_item_id:failProductLine,quantity_received:1},
          {purchase_item_id:failRawLine,quantity_received:1},
        ])]);
      expect(recovered,JSON.stringify(recovered)).toMatchObject({success:true,fully_received:true,status:'completed'});
      const {rows:[recovery]}=await db.query<{receipts:string; product_qty:string; raw_qty:string; journals:string}>(
        "select (select count(*)::text from public.purchase_receipts where purchase_id=$1) receipts, " +
        "(select coalesce(sum(quantity),0)::text from public.inventory where product_id=$2 and warehouse_id=$4) product_qty, " +
        "(select coalesce(sum(quantity),0)::text from public.raw_material_inventory where raw_material_id=$3 and branch_id=$5) raw_qty, " +
        "(select count(*)::text from public.journal_entries where reference_type='purchase' and reference_id=$1) journals",
        [failPoId,product,raw,warehouse,branch]);
      expect({
        ...recovery,
        product_qty:Number(recovery.product_qty),
        raw_qty:Number(recovery.raw_qty),
      }).toEqual({receipts:'1',product_qty:5,raw_qty:4,journals:'1'});

    } finally {
      await db.query('ROLLBACK');
    }
  });
});
