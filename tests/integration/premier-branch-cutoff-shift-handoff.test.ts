import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Run only on disposable loopback PostgreSQL with the canonical migration replay.
const dbUrl = process.env.SUPABASE_DB_URL;
const isDisposable = !!dbUrl && /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(dbUrl);
const describeDisposable = isDisposable ? describe : describe.skip;

describeDisposable('Premier branch-configured cutoff and open-order shift handoff', () => {
  const client = new Client({ connectionString: dbUrl });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });

  it('uses 10:00–02:00 Cairo boundaries and preserves an open order while closing its old shift', async () => {
    const org = randomUUID(), branch = randomUUID(), user = randomUUID(), shift = randomUUID(), order = randomUUID();
    const tag = randomUUID().slice(0, 12);
    const email = `ci-cutoff-${tag}@ci.invalid`;
    await client.query('BEGIN');
    try {
      await client.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
        VALUES('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) ON CONFLICT(role) DO NOTHING`);
      await client.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)',
        [org, 'CI Cutoff', `ci-cutoff-${tag}`]);
      await client.query('INSERT INTO public.branches(id,name,organization_id,is_active) VALUES($1,$2,$3,true)',
        [branch, 'CI Cutoff Branch', org]);
      await client.query(`INSERT INTO public.branch_settings(branch_id,business_day_mode,business_day_start,business_day_end,auto_close_shift_at_day_end)
        VALUES($1,'fixed_time','10:00','02:00',true)
        ON CONFLICT(branch_id) DO UPDATE SET business_day_mode='fixed_time',business_day_start='10:00',
          business_day_end='02:00',auto_close_shift_at_day_end=true`, [branch]);
      await client.query('INSERT INTO auth.users(id,email,created_at,updated_at) VALUES($1,$2,now(),now())',
        [user, email]);
      await client.query("SELECT set_config('app.register_branch','on',true)");
      await client.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
        VALUES($1,$2,'CI Cutoff Cashier','super_admin',$3,true)`, [user, email, branch]);
      await client.query("SELECT set_config('app.register_branch','off',true)");

      const configured = await client.query<{ cutoff_local: string }>(`SELECT
        to_char(private.business_day_fixed_cutoff($1,'2026-11-11') AT TIME ZONE 'Africa/Cairo',
          'YYYY-MM-DD HH24:MI') cutoff_local`, [branch]);
      expect(configured.rows[0].cutoff_local).toBe('2026-11-12 02:00');

      await client.query(`INSERT INTO public.shifts(id,branch_id,cashier_id,status,opened_at,opening_amount)
        VALUES($1,$2,$3,'open',now()-interval '20 minutes',0)`, [shift, branch, user]);
      await client.query(`INSERT INTO public.orders(id,branch_id,order_number,status,payment_status,order_type,subtotal,total)
        VALUES($1,$2,$3,'open','unpaid','takeaway',40,40)`, [order, branch, `CI-${tag}`]);

      // Keep the public 10:00–02:00 policy assertion above. For a safe
      // transactional execution test, set this fixture's cutoff to one minute
      // ago; no wall-clock sleeps or production dates are involved.
      const cutoffClock = await client.query<{ cutoff: Date; end_time: string }>(`
        SELECT ((date_trunc('minute', clock_timestamp() AT TIME ZONE 'Africa/Cairo')
                  - interval '1 minute') AT TIME ZONE 'Africa/Cairo') AS cutoff,
               to_char((date_trunc('minute', clock_timestamp() AT TIME ZONE 'Africa/Cairo')
                  - interval '1 minute')::time,'HH24:MI') AS end_time`);
      await client.query(`UPDATE public.branch_settings
        SET business_day_start='00:00', business_day_end=$2
        WHERE branch_id=$1`, [branch, cutoffClock.rows[0].end_time]);
      const cutoff = new Date(cutoffClock.rows[0].cutoff).toISOString();
      const closed = await client.query<{ result: { closed: boolean; shift_id: string; actual: null } }>(
        'SELECT private.close_shift_at_business_day_cutoff($1,$2) result', [branch, cutoff]);
      expect(closed.rows[0].result.closed).toBe(true);
      expect(closed.rows[0].result.shift_id).toBe(shift);
      expect(closed.rows[0].result.actual).toBeNull();

      const state = await client.query<{
        status: string; closed_at: Date; actual_amount: string | null;
        difference: string | null; order_status: string; payment_status: string; sale_count: string;
      }>(`SELECT s.status,s.closed_at,s.actual_amount::text,s.difference::text,
        o.status order_status,o.payment_status,
        (SELECT count(*)::text FROM public.sales WHERE source_order_id=o.id) sale_count
        FROM public.shifts s CROSS JOIN public.orders o WHERE s.id=$1 AND o.id=$2`, [shift, order]);
      expect(state.rows[0].status).toBe('closed');
      expect(new Date(state.rows[0].closed_at).toISOString()).toBe(cutoff);
      expect(state.rows[0].actual_amount).toBeNull();
      expect(state.rows[0].difference).toBeNull();
      expect(state.rows[0].order_status).toBe('open');
      expect(state.rows[0].payment_status).toBe('unpaid');
      expect(state.rows[0].sale_count).toBe('0');

      const retry = await client.query<{ result: { closed: boolean; reason: string } }>(
        'SELECT private.close_shift_at_business_day_cutoff($1,$2) result', [branch, cutoff]);
      expect(retry.rows[0].result).toMatchObject({ closed: false, reason: 'NO_OPEN_SHIFT' });

      // Settlement must be on a subsequent separately opened shift, never the
      // closed shift. This fixture deliberately does not create a financial sale.
      const successor = randomUUID();
      await client.query(`INSERT INTO public.shifts(id,branch_id,cashier_id,status,opened_at,opening_amount)
        VALUES($1,$2,$3,'open',now(),0)`, [successor, branch, user]);
      const active = await client.query<{ id: string }>(
        "SELECT id FROM public.shifts WHERE branch_id=$1 AND status='open'", [branch]);
      expect(active.rows.map(row => row.id)).toEqual([successor]);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('rejects disabled configuration, post-cutoff financial operations and historic retroactive closure', async () => {
    const org = randomUUID(), branch = randomUUID(), user = randomUUID(), shift = randomUUID();
    const tag = randomUUID().slice(0, 12);
    const email = `ci-cutoff-safety-${tag}@ci.invalid`;
    await client.query('BEGIN');
    try {
      await client.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
        VALUES('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true) ON CONFLICT(role) DO NOTHING`);
      await client.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)',
        [org,'CI Cutoff Safety',`ci-cutoff-safe-${tag}`]);
      await client.query('INSERT INTO public.branches(id,name,organization_id) VALUES($1,$2,$3)',
        [branch,'CI Cutoff Safety Branch',org]);
      await client.query(`INSERT INTO public.branch_settings(branch_id,business_day_mode,business_day_start,business_day_end,auto_close_shift_at_day_end)
        VALUES($1,'fixed_time','10:00','02:00',false)
        ON CONFLICT(branch_id) DO UPDATE SET business_day_mode='fixed_time',business_day_start='10:00',
          business_day_end='02:00',auto_close_shift_at_day_end=false`, [branch]);
      await client.query('INSERT INTO auth.users(id,email,created_at,updated_at) VALUES($1,$2,now(),now())',
        [user,email]);
      await client.query("SELECT set_config('app.register_branch','on',true)");
      await client.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
        VALUES($1,$2,'CI Safety Cashier','super_admin',$3,true)`, [user,email,branch]);
      await client.query("SELECT set_config('app.register_branch','off',true)");
      await client.query(`INSERT INTO public.shifts(id,branch_id,cashier_id,status,opened_at,opening_amount)
        VALUES($1,$2,$3,'open',now()-interval '20 minutes',0)`, [shift,branch,user]);
      // Keep the public 10:00–02:00 policy assertion above. For a safe
      // transactional execution test, set this fixture's cutoff to one minute
      // ago; no wall-clock sleeps or production dates are involved.
      const cutoffClock = await client.query<{ cutoff: Date; end_time: string }>(`
        SELECT ((date_trunc('minute', clock_timestamp() AT TIME ZONE 'Africa/Cairo')
                  - interval '1 minute') AT TIME ZONE 'Africa/Cairo') AS cutoff,
               to_char((date_trunc('minute', clock_timestamp() AT TIME ZONE 'Africa/Cairo')
                  - interval '1 minute')::time,'HH24:MI') AS end_time`);
      await client.query(`UPDATE public.branch_settings
        SET business_day_start='00:00', business_day_end=$2
        WHERE branch_id=$1`, [branch, cutoffClock.rows[0].end_time]);
      const cutoff = new Date(cutoffClock.rows[0].cutoff).toISOString();

      await client.query('SAVEPOINT disabled_case');
      await expect(client.query('SELECT private.close_shift_at_business_day_cutoff($1,$2)', [branch,cutoff]))
        .rejects.toThrow('AUTO_CLOSE_DISABLED_BY_BRANCH_SETTINGS');
      await client.query('ROLLBACK TO SAVEPOINT disabled_case');

      await client.query('UPDATE public.branch_settings SET auto_close_shift_at_day_end=true WHERE branch_id=$1', [branch]);
      await client.query(`INSERT INTO public.shift_operations(
        shift_id,operation_type,amount,payment_method,reference_type,created_by,created_at
      ) VALUES($1,'opening',0,'cash','shift_opening',$2,now())`, [shift,user]);

      await client.query('SAVEPOINT late_case');
      await expect(client.query('SELECT private.close_shift_at_business_day_cutoff($1,$2)', [branch,cutoff]))
        .rejects.toThrow('SHIFT_POST_CUTOFF_OPERATIONS_REVIEW_REQUIRED');
      await client.query('ROLLBACK TO SAVEPOINT late_case');

      await client.query('SAVEPOINT historical_case');
      await expect(client.query('SELECT private.close_shift_at_business_day_cutoff($1,$2)',
        [branch, new Date(Date.now() - 48 * 60 * 60_000).toISOString()]))
        .rejects.toThrow('HISTORICAL_SHIFT_CUTOFF_REQUIRES_REVIEW');
      await client.query('ROLLBACK TO SAVEPOINT historical_case');

      const state = await client.query<{ status: string }>(
        'SELECT status FROM public.shifts WHERE id=$1', [shift]);
      expect(state.rows[0].status).toBe('open');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('blocks admin normal and split settlement of a carried order with no active shift before financial writes', async () => {
    const org = randomUUID(), branch = randomUUID(), user = randomUUID(), order = randomUUID();
    const tag = randomUUID().slice(0, 10);
    const email = `ci-carry-admin-${tag}@ci.invalid`;
    await client.query('BEGIN');
    try {
      await client.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
        VALUES('super_admin','مدير النظام','Super Admin','[]'::jsonb,'global',true)
        ON CONFLICT(role) DO NOTHING`);
      await client.query('INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)',
        [org,'CI Carryover Admin',`ci-carry-${tag}`]);
      await client.query('INSERT INTO public.branches(id,name,organization_id) VALUES($1,$2,$3)',
        [branch,'CI Carryover Admin Branch',org]);
      await client.query('INSERT INTO auth.users(id,email,created_at,updated_at) VALUES($1,$2,now(),now())',
        [user,email]);
      await client.query("SELECT set_config('app.register_branch','on',true)");
      await client.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
        VALUES($1,$2,'CI Carryover Admin','super_admin',$3,true)`, [user,email,branch]);
      await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.jwt',$2,true),set_config('app.register_branch','off',true)",
        [user,JSON.stringify({sub:user,role:'authenticated'})]);
      await client.query(`INSERT INTO public.orders(id,branch_id,order_number,status,payment_status,order_type,subtotal,total)
        VALUES($1,$2,$3,'open','unpaid','takeaway',2,2)`, [order,branch,`CI-CARRY-${tag}`]);

      const check = await client.query<{ can_pay: boolean }>(
        "SELECT public.can_permission('pos.payment.take') AS can_pay");
      expect(check.rows[0].can_pay).toBe(true);

      const normal = await client.query<{ result: { success: boolean; error: string } }>(`
        SELECT public.process_sale(
          p_invoice_number => $1, p_branch_id => $2, p_warehouse_id => NULL,
          p_customer_id => NULL, p_salesperson_id => $3,
          p_subtotal => 2, p_discount_amount => 0, p_discount_type => 'amount',
          p_tax_amount => 0, p_bonus_amount => 0, p_total => 2, p_paid_amount => 2,
          p_payment_method => 'cash', p_status => 'completed',
          p_items => '[]'::jsonb, p_shift_id => NULL, p_order_id => $4
        ) AS result`, [`CI-NORMAL-${tag}`,branch,user,order]);
      expect(normal.rows[0].result).toMatchObject({ success:false,error:'NO_OPEN_SHIFT' });

      const split = await client.query<{ result: { success: boolean; error: string } }>(`
        SELECT public.process_sale_split(
          p_invoice_number => $1, p_branch_id => $2, p_warehouse_id => NULL,
          p_customer_id => NULL, p_salesperson_id => $3,
          p_subtotal => 2, p_discount_amount => 0, p_discount_type => 'amount',
          p_tax_amount => 0, p_bonus_amount => 0, p_total => 2,
          p_payments => '[{"payment_method":"cash","amount":1},{"payment_method":"card","amount":1}]'::jsonb,
          p_status => 'completed', p_items => '[]'::jsonb, p_shift_id => NULL, p_order_id => $4
        ) AS result`, [`CI-SPLIT-${tag}`,branch,user,order]);
      expect(split.rows[0].result).toMatchObject({ success:false,error:'NO_OPEN_SHIFT' });

      const unchanged = await client.query<{ status: string; payment_status: string; sales: string; journal: string }>(`
        SELECT o.status,o.payment_status,
          (SELECT count(*)::text FROM public.sales s WHERE s.source_order_id=o.id) sales,
          (SELECT count(*)::text FROM public.journal_entries j WHERE j.branch_id=o.branch_id) journal
        FROM public.orders o WHERE o.id=$1`, [order]);
      expect(unchanged.rows[0]).toMatchObject({
        status:'open',payment_status:'unpaid',sales:'0',journal:'0'
      });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
