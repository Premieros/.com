import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL is required for integration tests');

type JsonResult = { success?: boolean; error?: string; [key: string]: unknown };

describe('full ERP/POS operating cycle', () => {
  const client = new Client({ connectionString });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('runs purchase -> manufacturing -> sale -> offline reconcile -> negative stock -> replenishment -> accounting in one isolated transaction', async () => {
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    const userId = randomUUID();
    const unitId = randomUUID();
    const rawId = randomUUID();
    const productId = randomUUID();
    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    const userEmail = `cycle-${token}@ci.invalid`;

    const json = async (sql: string, params: unknown[] = []) => {
      const { rows } = await client.query<{ result: JsonResult }>(sql, params);
      return rows[0]?.result;
    };

    await client.query('BEGIN');

    try {
      await client.query(
        `insert into public.roles(role,name_ar,name_en,permissions,scope,is_active)
         values('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
         on conflict(role) do nothing`,
      );

      await client.query(
        `insert into public.branches(id,name,is_active)
         values($1,$2,true)`,
        [branchId, `CI Full Cycle ${token}`],
      );

      await client.query(
        `insert into auth.users(id,email,created_at,updated_at)
         values($1,$2,now(),now())`,
        [userId, userEmail],
      );

      await client.query("select set_config('app.register_branch','on',true)");

      await client.query(
        `insert into public.users(id,email,full_name,role,branch_id,is_active)
         values($1,$2,'CI Full Cycle','super_admin',$3,true)`,
        [userId, userEmail, branchId],
      );

      await client.query(
        `select set_config('app.user_id',$1,true),
                set_config('app.jwt',$2,true),
                set_config('app.register_branch','off',true)`,
        [userId, JSON.stringify({ sub: userId, role: 'authenticated' })],
      );

      await client.query(
        `insert into public.warehouses(id,name,branch_id,is_active,is_default)
         values($1,'CI Warehouse',$2,true,true)`,
        [warehouseId, branchId],
      );

      await client.query(
        `insert into public.branch_settings(branch_id,tax_enabled,tax_rate,allow_negative_stock)
         values($1,false,0,false)
         on conflict(branch_id) do update
         set tax_enabled=false,tax_rate=0,allow_negative_stock=false,updated_at=now()`,
        [branchId],
      );

      await client.query('select public.seed_account_mappings($1)', [branchId]);

      await client.query(
        `insert into public.measurement_units(id,code,name,symbol,is_active)
         values($1,$2,'CI Unit','u',true)`,
        [unitId, `CIU-${token}`],
      );

      await client.query(
        `insert into public.raw_materials(id,code,name,unit_id,default_cost,is_active,branch_id)
         values($1,$2,'CI Raw Material',$3,2,true,$4)`,
        [rawId, `CIR-${token}`, unitId, branchId],
      );

      await client.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values($1,'CI Manufactured',$2,0,15,15,true,'manufactured',$3)`,
        [productId, `CIP-${token}`, branchId],
      );

      const recipe = await client.query<{ id: string }>(
        `insert into public.recipes(product_id,branch_id,name,yield_quantity,is_active)
         values($1,$2,'CI Recipe',1,true)
         returning id`,
        [productId, branchId],
      );
      const recipeId = recipe.rows[0].id;

      await client.query(
        `insert into public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
         values($1,$2,2,0)`,
        [recipeId, rawId],
      );

      // 1) Purchase raw material: 20 units × 2 = 40.
      const purchaseRaw = await json(
        `select public.process_purchase(
          $1,null,$2,$3,40,0,0,40,40,'cash','completed','CI raw purchase',
          jsonb_build_array(jsonb_build_object(
            'raw_material_id',$4::text,'quantity',20,'unit_cost',2,'unit_name','u','batch_number',$5::text
          ))
        ) as result`,
        [`PUR-RAW-${token}`, branchId, warehouseId, rawId, `RB-${token}`],
      );
      expect(purchaseRaw?.success).toBe(true);

      const rawStockBeforeProduction = await client.query<{ qty: string }>(
        `select coalesce(sum(quantity),0)::text as qty
         from public.raw_material_batches
         where raw_material_id=$1 and branch_id=$2`,
        [rawId, branchId],
      );
      expect(Number(rawStockBeforeProduction.rows[0].qty)).toBe(20);

      // 2) Manufacturing: 5 finished units, consuming 10 raw units.
      const createProduction = await json(
        `select public.create_production_order($1,$2,$3,5,$4,current_date,'CI full-cycle production') as result`,
        [productId, branchId, warehouseId, `PB-${token}`],
      );
      expect(createProduction?.success).toBe(true);
      const productionOrderId = String(createProduction?.order_id);

      const startProduction = await json(
        'select public.start_production_order($1) as result',
        [productionOrderId],
      );
      expect(startProduction?.success).toBe(true);

      const completeProduction = await json(
        `select public.complete_production_order($1,'[]'::jsonb) as result`,
        [productionOrderId],
      );
      expect(completeProduction?.success, JSON.stringify(completeProduction)).toBe(true);
      expect(Number(completeProduction?.total_cost)).toBe(20);

      const postProduction = await client.query<{ raw_qty: string; product_qty: string }>(
        `select
           (select coalesce(sum(quantity),0) from public.raw_material_batches where raw_material_id=$1 and branch_id=$2)::text as raw_qty,
           (select coalesce(quantity,0) from public.inventory where product_id=$3 and warehouse_id=$4)::text as product_qty`,
        [rawId, branchId, productId, warehouseId],
      );
      expect(Number(postProduction.rows[0].raw_qty)).toBe(10);
      expect(Number(postProduction.rows[0].product_qty)).toBe(5);

      // 3) Normal sale: 2 × 15 = 30, stock 5 -> 3.
      const sale1Invoice = `INV-CYCLE-${token}-1`;
      const sale1 = await json(
        `select public.process_sale(
          $1,$2,$3,null,$4,30,0,'amount',0,0,30,30,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',2,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [sale1Invoice, branchId, warehouseId, userId, productId],
      );
      expect(sale1?.success).toBe(true);
      expect(Number(sale1?.cogs)).toBe(8);

      // 4) Offline-style sale and retry/reconciliation: must never duplicate.
      const offlineInvoice = `INV-OFF-${token}`;
      const offlineSale = await json(
        `select public.process_sale(
          $1,$2,$3,null,$4,15,0,'amount',0,0,15,15,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',1,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [offlineInvoice, branchId, warehouseId, userId, productId],
      );
      expect(offlineSale?.success).toBe(true);

      const retrySale = await json(
        `select public.process_sale(
          $1,$2,$3,null,$4,15,0,'amount',0,0,15,15,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',1,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [offlineInvoice, branchId, warehouseId, userId, productId],
      );
      expect(retrySale?.success).not.toBe(true);

      const reconcile = await json(
        'select public.reconcile_offline_sale($1,$2,15,\'cash\') as result',
        [offlineInvoice, branchId],
      );
      expect(reconcile?.success).toBe(true);

      const offlineCount = await client.query<{ count: string }>(
        'select count(*)::text as count from public.sales where branch_id=$1 and invoice_number=$2',
        [branchId, offlineInvoice],
      );
      expect(Number(offlineCount.rows[0].count)).toBe(1);

      // Stock is now 2.
      const stockBeforeNegative = await client.query<{ qty: string }>(
        'select quantity::text as qty from public.inventory where product_id=$1 and warehouse_id=$2',
        [productId, warehouseId],
      );
      expect(Number(stockBeforeNegative.rows[0].qty)).toBe(2);

      // 5) Negative stock OFF: selling 3 must fail and leave stock unchanged.
      expect(
        (
          await client.query<{ value: boolean }>(
            'select public.effective_allow_negative_stock($1) as value',
            [branchId],
          )
        ).rows[0].value,
      ).toBe(false);

      const blockedInvoice = `INV-BLOCK-${token}`;
      const blockedSale = await json(
        `select public.process_sale(
          $1,$2,$3,null,$4,45,0,'amount',0,0,45,45,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',3,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [blockedInvoice, branchId, warehouseId, userId, productId],
      );
      expect(blockedSale?.success).not.toBe(true);

      const blockedCount = await client.query<{ count: string }>(
        'select count(*)::text as count from public.sales where branch_id=$1 and invoice_number=$2',
        [branchId, blockedInvoice],
      );
      expect(Number(blockedCount.rows[0].count)).toBe(0);

      // 6) Negative stock ON: selling 5 with only 2 available creates debt 3 and stock -3.
      await client.query(
        'update public.branch_settings set allow_negative_stock=true,updated_at=now() where branch_id=$1',
        [branchId],
      );
      expect(
        (
          await client.query<{ value: boolean }>(
            'select public.effective_allow_negative_stock($1) as value',
            [branchId],
          )
        ).rows[0].value,
      ).toBe(true);

      const negativeInvoice = `INV-NEG-${token}`;
      const negativeSale = await json(
        `select public.process_sale(
          $1,$2,$3,null,$4,75,0,'amount',0,0,75,75,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',5,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [negativeInvoice, branchId, warehouseId, userId, productId],
      );
      expect(negativeSale?.success).toBe(true);

      const debtState = await client.query<{
        stock_qty: string;
        debt_qty: string;
        settled_qty: string;
      }>(
        `select
           (select quantity from public.inventory where product_id=$1 and warehouse_id=$2)::text as stock_qty,
           d.debt_quantity::text as debt_qty,
           d.settled_quantity::text as settled_qty
         from public.product_stock_debts d
         where d.product_id=$1 and d.branch_id=$3 and d.warehouse_id=$2
         order by d.created_at desc
         limit 1`,
        [productId, warehouseId, branchId],
      );
      expect(Number(debtState.rows[0].stock_qty)).toBe(-3);
      expect(Number(debtState.rows[0].debt_qty)).toBe(3);
      expect(Number(debtState.rows[0].settled_qty)).toBe(0);

      // 7) Replenishment: purchase 5 ready units; debt 3 settles, available stock becomes 2.
      const purchaseReady = await json(
        `select public.process_purchase(
          $1,null,$2,$3,25,0,0,25,25,'cash','completed','CI debt settlement purchase',
          jsonb_build_array(jsonb_build_object(
            'product_id',$4::text,'quantity',5,'unit_cost',5,'unit_name','piece','batch_number',$5::text
          ))
        ) as result`,
        [`PUR-FG-${token}`, branchId, warehouseId, productId, `FB-${token}`],
      );
      expect(purchaseReady?.success).toBe(true);

      const settledDebt = await client.query<{
        stock_qty: string;
        debt_qty: string;
        settled_qty: string;
        status: string;
      }>(
        `select
           (select quantity from public.inventory where product_id=$1 and warehouse_id=$2)::text as stock_qty,
           d.debt_quantity::text as debt_qty,
           d.settled_quantity::text as settled_qty,
           d.reconciliation_status as status
         from public.product_stock_debts d
         where d.product_id=$1 and d.branch_id=$3 and d.warehouse_id=$2
         order by d.created_at desc
         limit 1`,
        [productId, warehouseId, branchId],
      );
      expect(Number(settledDebt.rows[0].stock_qty)).toBe(2);
      expect(Number(settledDebt.rows[0].settled_qty)).toBe(3);
      expect(settledDebt.rows[0].status).toBe('settled');

      // 8) Manual accounting entry.
      const manual = await json(
        `select public.post_manual_journal(
          $1,'CI full-cycle manual journal',
          jsonb_build_array(
            jsonb_build_object('account_key','cash','debit',10,'credit',0,'note','cycle'),
            jsonb_build_object('account_key','other_income','debit',0,'credit',10,'note','cycle')
          )
        ) as result`,
        [branchId],
      );
      expect(manual?.success).toBe(true);

      // 9) Global invariants: every journal is balanced and all cycle source documents exist.
      const unbalanced = await client.query<{ count: string }>(
        `select count(*)::text as count
         from (
           select je.id,
                  round(coalesce(sum(jl.debit),0),2) as debit,
                  round(coalesce(sum(jl.credit),0),2) as credit
           from public.journal_entries je
           join public.journal_entry_lines jl on jl.journal_entry_id=je.id
           where je.branch_id=$1
           group by je.id
           having round(coalesce(sum(jl.debit),0),2) <> round(coalesce(sum(jl.credit),0),2)
         ) q`,
        [branchId],
      );
      expect(Number(unbalanced.rows[0].count)).toBe(0);

      const lifecycle = await client.query<{
        purchases: string;
        sales: string;
        productions: string;
        journals: string;
      }>(
        `select
           (select count(*) from public.purchases where branch_id=$1)::text as purchases,
           (select count(*) from public.sales where branch_id=$1)::text as sales,
           (select count(*) from public.production_orders where branch_id=$1 and status='completed')::text as productions,
           (select count(*) from public.journal_entries where branch_id=$1)::text as journals`,
        [branchId],
      );

      expect(Number(lifecycle.rows[0].purchases)).toBe(2);
      expect(Number(lifecycle.rows[0].sales)).toBe(3);
      expect(Number(lifecycle.rows[0].productions)).toBe(1);
      expect(Number(lifecycle.rows[0].journals)).toBeGreaterThanOrEqual(7);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
