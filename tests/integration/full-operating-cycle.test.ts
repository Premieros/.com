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
    const organizationId = randomUUID();
    const warehouseId = randomUUID();
    const userId = randomUUID();
    const unitId = randomUUID();
    const rawId = randomUUID();
    const productId = randomUUID();
    const readyProductId = randomUUID();
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

      await client.query(`insert into public.organizations(id,name,slug) values($1,$2,$3)`,
        [organizationId, `CI Test Org ${token}`, `ci-test-${token}`]);
      await client.query(`insert into public.branches(id,name,is_active,organization_id) values($1,$2,true,$3)`,
        [branchId, `CI Full Cycle ${token}`, organizationId]);

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

      // The same opaque code works across visits, only for the originating branch.
      await client.query('SET LOCAL ROLE anon');
      const supportCode = (await client.query(
        "select public.customer_support_start($1,'complaint','CI customer message') code", [branchId],
      )).rows[0].code as string;
      expect(supportCode).toMatch(/^[0-9a-f]{32}$/);
      const retried = await client.query(
        "select public.customer_support_start($1,'complaint','CI customer message',$2) code", [branchId, supportCode]);
      expect(retried.rows[0].code).toBe(supportCode);
      const publicMessages = await client.query('select public.customer_support_follow($1,$2) messages', [branchId, supportCode]);
      expect(publicMessages.rows[0].messages).toHaveLength(1);
      expect(publicMessages.rows[0].messages).toMatchObject([{ from_staff: false, body: 'CI customer message' }]);
      await client.query('RESET ROLE');
      await client.query('SAVEPOINT invalid_support_scope');
      await expect(client.query('select public.customer_support_follow($1,$2)', [randomUUID(), supportCode]))
        .rejects.toThrow('SUPPORT_CODE_INVALID');
      await client.query('ROLLBACK TO SAVEPOINT invalid_support_scope');
      await client.query('SET LOCAL ROLE authenticated');
      const inbox = await client.query('select public.customer_support_staff_list($1) threads', [branchId]);
      await client.query('select public.customer_support_staff_thread($1,$2,$3)',
        [branchId, inbox.rows[0].threads[0].id, 'CI branch reply']);
      await client.query('RESET ROLE');
      const follow = await client.query('select public.customer_support_follow($1,$2) messages', [branchId, supportCode]);
      expect(follow.rows[0].messages).toEqual(expect.arrayContaining([expect.objectContaining({ from_staff: true, body: 'CI branch reply' })]));
      expect((await client.query("select has_function_privilege('anon','public.customer_support_staff_list(uuid,uuid)','execute') allowed"))
        .rows[0].allowed).toBe(false);

      const deliveryOrder = randomUUID();
      await client.query("insert into public.orders(id,order_number,branch_id,order_type,cashier_id) values($1,$2,$3,'delivery',$4)",
        [deliveryOrder, `CI-DEL-${token}`, branchId, userId]);
      await client.query('SET LOCAL ROLE authenticated');
      const deliveryDriver = (await client.query("select public.delivery_save_directory($1,'driver','CI driver') id", [branchId])).rows[0].id;
      const deliveryService = (await client.query("select public.delivery_save_directory($1,'service','CI service') id", [branchId])).rows[0].id;
      const dispatch = 'select public.delivery_update_dispatch($1,$2,$3,$4,$5,$6) result';
      expect((await client.query(dispatch, [branchId, deliveryOrder, 0, 'assigned', deliveryService, deliveryDriver])).rows[0].result).toBe(1);
      await client.query('SAVEPOINT premature_dispatch');
      await expect(client.query(dispatch, [branchId, deliveryOrder, 1, 'on_the_way', deliveryService, deliveryDriver]))
        .rejects.toThrow('DELIVERY_PREPARATION_REQUIRED');
      await client.query('ROLLBACK TO SAVEPOINT premature_dispatch');
      await client.query('RESET ROLE');
      await client.query("update public.orders set kitchen_status='ready' where id=$1", [deliveryOrder]);
      await client.query('SET LOCAL ROLE authenticated');
      expect((await client.query(dispatch, [branchId, deliveryOrder, 1, 'on_the_way', deliveryService, deliveryDriver])).rows[0].result).toBe(2);
      const desk = await client.query('select public.delivery_workspace($1) result', [branchId]);
      expect(desk.rows[0].result.orders).toContainEqual(expect.objectContaining({
        id: deliveryOrder, driver_id: deliveryDriver, service_id: deliveryService, dispatch_status: 'on_the_way',
        order_status: 'open',
      }));
      await client.query('SAVEPOINT stale_dispatch');
      await expect(client.query(dispatch, [branchId, deliveryOrder, 1, 'delivered', deliveryService, deliveryDriver]))
        .rejects.toThrow('DELIVERY_REFRESH_REQUIRED');
      await client.query('ROLLBACK TO SAVEPOINT stale_dispatch');
      expect((await client.query(dispatch, [branchId, deliveryOrder, 2, 'delivered', deliveryService, deliveryDriver])).rows[0].result).toBe(3);
      await client.query('RESET ROLE');
      expect((await client.query('select status from public.orders where id=$1', [deliveryOrder])).rows[0].status).toBe('open');

      const atomicSku = `CI-ATOMIC-${token}`;
      const atomicProduct = { p_name: 'CI Product With Ingredients', p_branch_id: branchId, p_sku: atomicSku, p_sale_price: 15 };
      await client.query('SAVEPOINT invalid_product_recipe');
      await expect(client.query('select public.create_product_with_raw_components($1,$2)', [
        atomicProduct, JSON.stringify([{ raw_material_id: rawId, quantity: 0 }]),
      ])).rejects.toThrow('INVALID_DIRECT_RAW_COMPONENT');
      await client.query('ROLLBACK TO SAVEPOINT invalid_product_recipe');
      expect((await client.query('select id from public.products where sku=$1', [atomicSku])).rowCount).toBe(0);

      await client.query('SET LOCAL ROLE authenticated');
      const atomic = await json('select public.create_product_with_raw_components($1,$2) result', [
        atomicProduct, JSON.stringify([{ raw_material_id: rawId, quantity: 2 }]),
      ]);
      await client.query('RESET ROLE');
      expect(atomic?.success).toBe(true);
      const atomicRecipe = await client.query(`
        select p.product_type, i.quantity::float8 as quantity
        from public.products p join public.recipes r on r.product_id=p.id
        join public.recipe_items i on i.recipe_id=r.id
        where p.sku=$1 and i.raw_material_id=$2
      `, [atomicSku, rawId]);
      expect(atomicRecipe.rows).toEqual([{ product_type: 'manufactured', quantity: 2 }]);

      await client.query(
        `insert into public.products(id,name,sku,cost_price,sale_price,wholesale_price,is_active,product_type,branch_id)
         values
           ($1,'CI Manufactured',$2,0,15,15,true,'manufactured',$4),
           ($3,'CI Ready',$5,5,10,10,true,'ready',$4)`,
        [productId, `CIP-${token}`, readyProductId, branchId, `CIRP-${token}`],
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
      // Actual manufactured batch: 20 raw cost / 5 finished units = 4.
      // The sale must consume this batch cost, not products.cost_price=0.
      const producedBatch = await client.query<{ unit_cost: string; quantity: string }>(
        `select unit_cost::text,quantity::text
         from public.inventory_batches
         where product_id=$1 and branch_id=$2 and warehouse_id=$3
           and batch_number=$4 and quantity>0`,
        [productId, branchId, warehouseId, `PB-${token}`],
      );
      expect(producedBatch.rows).toHaveLength(1);
      expect(Number(producedBatch.rows[0].unit_cost)).toBe(4);
      expect(Number(producedBatch.rows[0].quantity)).toBe(5);

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
      // Inventory ledger, RPC COGS and the production batch must agree.
      const saleCostLedger = await client.query<{ ledger_cost: string; quantity: string }>(
        `select coalesce(sum(total_cost),0)::text as ledger_cost,
                coalesce(sum(quantity),0)::text as quantity
         from public.inventory_ledger
         where branch_id=$1 and product_id=$2
           and reference_number=$3 and entry_type='sale'`,
        [branchId, productId, sale1Invoice],
      );
      expect(Number(saleCostLedger.rows[0].quantity)).toBe(-2);
      expect(Number(saleCostLedger.rows[0].ledger_cost)).toBe(-8);

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

      // Manufactured finished stock is now 2 and raw stock remains untouched by finished-stock sales.
      const stockBeforeNegative = await client.query<{ product_qty: string; raw_qty: string }>(
        `select
           (select quantity from public.inventory where product_id=$1 and warehouse_id=$2)::text as product_qty,
           (select coalesce(sum(quantity),0) from public.raw_material_batches where raw_material_id=$3 and branch_id=$4)::text as raw_qty`,
        [productId, warehouseId, rawId, branchId],
      );
      expect(Number(stockBeforeNegative.rows[0].product_qty)).toBe(2);
      expect(Number(stockBeforeNegative.rows[0].raw_qty)).toBe(10);

      // Seed a simple ready product specifically for negative-stock policy checks.
      const seedReady = await json(
        `select public.process_purchase(
          $1,null,$2,$3,10,0,0,10,10,'cash','completed','CI ready stock seed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$4::text,'quantity',2,'unit_cost',5,'unit_name','piece','batch_number',$5::text
          ))
        ) as result`,
        [`PUR-READY-SEED-${token}`, branchId, warehouseId, readyProductId, `RS-${token}`],
      );
      expect(seedReady?.success).toBe(true);

      // 5) Negative stock OFF: selling 3 with only 2 ready units must fail.
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
          $1,$2,$3,null,$4,30,0,'amount',0,0,30,30,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',3,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [blockedInvoice, branchId, warehouseId, userId, readyProductId],
      );
      expect(blockedSale?.success).not.toBe(true);

      const blockedCount = await client.query<{ count: string }>(
        'select count(*)::text as count from public.sales where branch_id=$1 and invoice_number=$2',
        [branchId, blockedInvoice],
      );
      expect(Number(blockedCount.rows[0].count)).toBe(0);

      // 6) Negative stock ON: selling 5 with only 2 ready units creates debt 3 and stock -3.
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
          $1,$2,$3,null,$4,50,0,'amount',0,0,50,50,'cash','completed',
          jsonb_build_array(jsonb_build_object(
            'product_id',$5::text,'quantity',5,'unit_name','piece','discount_amount',0,'modifier_option_ids','[]'::jsonb
          )),
          null,'takeaway',null,null,1
        ) as result`,
        [negativeInvoice, branchId, warehouseId, userId, readyProductId],
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
        [readyProductId, warehouseId, branchId],
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
        [`PUR-FG-${token}`, branchId, warehouseId, readyProductId, `FB-${token}`],
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
        [readyProductId, warehouseId, branchId],
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

      expect(Number(lifecycle.rows[0].purchases)).toBe(3);
      expect(Number(lifecycle.rows[0].sales)).toBe(3);
      expect(Number(lifecycle.rows[0].productions)).toBe(1);
      expect(Number(lifecycle.rows[0].journals)).toBeGreaterThanOrEqual(7);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
