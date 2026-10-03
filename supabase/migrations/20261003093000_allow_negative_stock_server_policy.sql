-- Server-authoritative negative-stock policy with branch override.
-- Company: settings.allow_negative_stock (default false)
-- Branch: branch_settings.allow_negative_stock (NULL = inherit company)
-- Ready products and inventory units use explicit debt rows so oversold stock
-- remains auditable and can be settled when replacement stock arrives.
-- Raw materials reuse the existing raw FIFO debt/reconciliation mechanism.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;

ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean;

-- Net product stock must be able to go below zero while the physical FIFO
-- batches remain auditable. Negative batches are restricted to internal sale
-- helpers below; normal public data paths remain protected by RLS.
ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_nonnegative_quantity;

ALTER TABLE public.inventory_batches
  DROP CONSTRAINT IF EXISTS inventory_batches_quantity_check;

CREATE TABLE IF NOT EXISTS public.product_stock_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  reference_number text,
  oversold_batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  debt_quantity numeric(18,6) NOT NULL CHECK (debt_quantity > 0),
  settled_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (settled_quantity >= 0 AND settled_quantity <= debt_quantity),
  reconciliation_status text NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending','settled','error')),
  reconciliation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_stock_debts_open
  ON public.product_stock_debts(product_id,branch_id,warehouse_id,created_at,id)
  WHERE settled_quantity < debt_quantity;

CREATE TABLE IF NOT EXISTS public.inventory_unit_stock_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  reference_number text,
  oversold_batch_id uuid REFERENCES public.inventory_unit_batches(id) ON DELETE SET NULL,
  debt_quantity numeric(18,6) NOT NULL CHECK (debt_quantity > 0),
  settled_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (settled_quantity >= 0 AND settled_quantity <= debt_quantity),
  reconciliation_status text NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending','settled','error')),
  reconciliation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_unit_stock_debts_open
  ON public.inventory_unit_stock_debts(unit_id,branch_id,warehouse_id,created_at,id)
  WHERE settled_quantity < debt_quantity;

ALTER TABLE public.product_stock_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit_stock_debts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_stock_debts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.inventory_unit_stock_debts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_stock_debts TO service_role, postgres;
GRANT ALL ON public.inventory_unit_stock_debts TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.effective_allow_negative_stock(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT bs.allow_negative_stock
       FROM public.branch_settings bs
      WHERE bs.branch_id = p_branch_id
      LIMIT 1),
    (SELECT s.allow_negative_stock
       FROM public.settings s
      ORDER BY s.updated_at DESC NULLS LAST, s.id
      LIMIT 1),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.effective_allow_negative_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_allow_negative_stock(uuid) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public._deduct_ready_product_stock_policy(
  p_product_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_reference_id uuid,
  p_reference_number text,
  p_allow_negative boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_available numeric(18,6):=0;
  v_running numeric(18,6):=0;
  v_need numeric(18,6);
  v_take numeric(18,6);
  v_total_cost numeric(18,6):=0;
  v_removed numeric(18,6):=0;
  v_oversold numeric(18,6):=0;
  v_batch record;
  v_debt_batch text;
  v_debt_batch_id uuid;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object('success',true,'removed',0,'oversold',0,'total_cost',0);
  END IF;

  IF p_warehouse_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('product-stock:'||p_product_id::text||':'||p_warehouse_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_available
  FROM public.inventory_batches
  WHERE product_id=p_product_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  IF NOT COALESCE(p_allow_negative,false) AND v_available<p_qty THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','INSUFFICIENT_READY_PRODUCT_STOCK',
      'product_id',p_product_id,
      'required',p_qty,
      'available',v_available
    );
  END IF;

  v_running:=v_available;
  v_need:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.inventory_batches
    WHERE product_id=p_product_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY expiry_date NULLS LAST,created_at,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_need<=0;
    v_take:=LEAST(v_need,v_batch.quantity);

    UPDATE public.inventory_batches
    SET quantity=quantity-v_take
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_ledger(
      product_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_product_id,p_branch_id,p_warehouse_id,v_batch.batch_number,
      -v_take,COALESCE(v_batch.unit_cost,0),-v_take*COALESCE(v_batch.unit_cost,0),
      v_running,v_running-v_take,
      'sale','sale',p_reference_id,p_reference_number,auth.uid()
    );

    INSERT INTO public.stock_transactions(
      product_id,warehouse_id,branch_id,transaction_type,component_flow,
      reference_type,reference_id,quantity,before_quantity,after_quantity,
      unit_cost,created_by
    ) VALUES (
      p_product_id,p_warehouse_id,p_branch_id,'sale',false,
      'sale',p_reference_id,-v_take,v_running,v_running-v_take,
      COALESCE(v_batch.unit_cost,0),auth.uid()
    );

    v_running:=v_running-v_take;
    v_need:=v_need-v_take;
    v_removed:=v_removed+v_take;
    v_total_cost:=v_total_cost+v_take*COALESCE(v_batch.unit_cost,0);
  END LOOP;

  IF v_need>0 THEN
    IF NOT COALESCE(p_allow_negative,false) THEN
      RAISE EXCEPTION 'INSUFFICIENT_READY_PRODUCT_STOCK product=% required=% available=%',
        p_product_id,p_qty,v_available;
    END IF;

    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.inventory_batches(
      product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost,
      source_type,source_id
    ) VALUES (
      p_product_id,p_warehouse_id,p_branch_id,v_debt_batch,-v_need,0,
      'sale_oversold',p_reference_id
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_ledger(
      product_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_product_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_need,0,0,v_running,v_running-v_need,
      'sale','sale',p_reference_id,p_reference_number,auth.uid()
    );

    INSERT INTO public.stock_transactions(
      product_id,warehouse_id,branch_id,transaction_type,component_flow,
      reference_type,reference_id,quantity,before_quantity,after_quantity,
      unit_cost,created_by
    ) VALUES (
      p_product_id,p_warehouse_id,p_branch_id,'sale',false,
      'sale',p_reference_id,-v_need,v_running,v_running-v_need,0,auth.uid()
    );

    INSERT INTO public.product_stock_debts(
      product_id,branch_id,warehouse_id,sale_id,reference_number,
      oversold_batch_id,debt_quantity
    ) VALUES (
      p_product_id,p_branch_id,p_warehouse_id,p_reference_id,p_reference_number,
      v_debt_batch_id,v_need
    );

    v_running:=v_running-v_need;
    v_oversold:=v_need;
    v_need:=0;
  END IF;

  INSERT INTO public.inventory(
    product_id,warehouse_id,branch_id,quantity,updated_at
  ) VALUES (
    p_product_id,p_warehouse_id,p_branch_id,v_running,now()
  )
  ON CONFLICT(product_id,warehouse_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      branch_id=EXCLUDED.branch_id,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'removed',v_removed,
    'oversold',v_oversold,
    'total_cost',v_total_cost,
    'after_qty',v_running
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._deduct_inventory_unit_stock_policy(
  p_unit_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_reference_id uuid,
  p_reference_number text,
  p_allow_negative boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_available numeric(18,6):=0;
  v_running numeric(18,6):=0;
  v_need numeric(18,6);
  v_take numeric(18,6);
  v_total_cost numeric(18,6):=0;
  v_removed numeric(18,6):=0;
  v_oversold numeric(18,6):=0;
  v_batch record;
  v_debt_batch text;
  v_debt_batch_id uuid;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object('success',true,'removed',0,'oversold',0,'total_cost',0);
  END IF;

  IF p_warehouse_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('unit-stock:'||p_unit_id::text||':'||p_warehouse_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_available
  FROM public.inventory_unit_batches
  WHERE unit_id=p_unit_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  IF NOT COALESCE(p_allow_negative,false) AND v_available<p_qty THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','INSUFFICIENT_UNIT_STOCK',
      'unit_id',p_unit_id,
      'required',p_qty,
      'available',v_available
    );
  END IF;

  v_running:=v_available;
  v_need:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.inventory_unit_batches
    WHERE unit_id=p_unit_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY created_at,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_need<=0;
    v_take:=LEAST(v_need,v_batch.quantity);

    UPDATE public.inventory_unit_batches
    SET quantity=quantity-v_take
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_unit_entries(
      unit_id,branch_id,warehouse_id,quantity,unit_cost,
      entry_type,reference_type,reference_id,reference_number,batch_number,created_by
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,-v_take,COALESCE(v_batch.unit_cost,0),
      'sale','sale',p_reference_id,p_reference_number,v_batch.batch_number,auth.uid()
    );

    v_running:=v_running-v_take;
    v_need:=v_need-v_take;
    v_removed:=v_removed+v_take;
    v_total_cost:=v_total_cost+v_take*COALESCE(v_batch.unit_cost,0);
  END LOOP;

  IF v_need>0 THEN
    IF NOT COALESCE(p_allow_negative,false) THEN
      RAISE EXCEPTION 'INSUFFICIENT_UNIT_STOCK unit=% required=% available=%',
        p_unit_id,p_qty,v_available;
    END IF;

    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.inventory_unit_batches(
      unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,v_debt_batch,-v_need,0
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_unit_entries(
      unit_id,branch_id,warehouse_id,quantity,unit_cost,
      entry_type,reference_type,reference_id,reference_number,batch_number,created_by
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,-v_need,0,
      'sale','sale',p_reference_id,p_reference_number,v_debt_batch,auth.uid()
    );

    INSERT INTO public.inventory_unit_stock_debts(
      unit_id,branch_id,warehouse_id,sale_id,reference_number,
      oversold_batch_id,debt_quantity
    ) VALUES (
      p_unit_id,p_branch_id,p_warehouse_id,p_reference_id,p_reference_number,
      v_debt_batch_id,v_need
    );

    v_running:=v_running-v_need;
    v_oversold:=v_need;
    v_need:=0;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'removed',v_removed,
    'oversold',v_oversold,
    'total_cost',v_total_cost,
    'after_qty',v_running
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._deduct_ready_product_stock_policy(uuid,uuid,uuid,numeric,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._deduct_inventory_unit_stock_policy(uuid,uuid,uuid,numeric,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._deduct_ready_product_stock_policy(uuid,uuid,uuid,numeric,uuid,text,boolean) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._deduct_inventory_unit_stock_policy(uuid,uuid,uuid,numeric,uuid,text,boolean) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public._settle_product_stock_debt_on_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_debt record;
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_res jsonb;
  v_error text;
BEGIN
  IF NEW.quantity<=0 OR NEW.source_type='sale_oversold' THEN
    RETURN NEW;
  END IF;

  v_remaining:=NEW.quantity;

  FOR v_debt IN
    SELECT d.*
    FROM public.product_stock_debts d
    WHERE d.product_id=NEW.product_id
      AND d.branch_id=NEW.branch_id
      AND d.warehouse_id=NEW.warehouse_id
      AND d.settled_quantity<d.debt_quantity
    ORDER BY d.created_at,d.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=LEAST(v_remaining,v_debt.debt_quantity-v_debt.settled_quantity);
    IF v_take<=0 THEN CONTINUE; END IF;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.inventory_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    v_error:=NULL;
    IF v_debt.sale_id IS NOT NULL AND COALESCE(NEW.unit_cost,0)>0 THEN
      BEGIN
        v_res:=public._fifo_adjust_sale_cogs_delta(
          v_debt.sale_id,
          v_take*COALESCE(NEW.unit_cost,0)
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
          v_error:=COALESCE(v_res->>'error','COGS_RECONCILIATION_FAILED');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_error:=SQLERRM;
      END;
    END IF;

    UPDATE public.product_stock_debts
    SET settled_quantity=settled_quantity+v_take,
        reconciliation_status=CASE
          WHEN v_error IS NOT NULL THEN 'error'
          WHEN settled_quantity+v_take>=debt_quantity THEN 'settled'
          ELSE 'pending'
        END,
        reconciliation_error=v_error,
        updated_at=now()
    WHERE id=v_debt.id;

    v_remaining:=v_remaining-v_take;
  END LOOP;

  IF v_remaining IS DISTINCT FROM NEW.quantity THEN
    UPDATE public.inventory_batches
    SET quantity=v_remaining
    WHERE id=NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._settle_inventory_unit_stock_debt_on_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_debt record;
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_res jsonb;
  v_error text;
BEGIN
  IF NEW.quantity<=0 OR NEW.batch_number LIKE 'OV-%' THEN
    RETURN NEW;
  END IF;

  v_remaining:=NEW.quantity;

  FOR v_debt IN
    SELECT d.*
    FROM public.inventory_unit_stock_debts d
    WHERE d.unit_id=NEW.unit_id
      AND d.branch_id=NEW.branch_id
      AND d.warehouse_id=NEW.warehouse_id
      AND d.settled_quantity<d.debt_quantity
    ORDER BY d.created_at,d.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=LEAST(v_remaining,v_debt.debt_quantity-v_debt.settled_quantity);
    IF v_take<=0 THEN CONTINUE; END IF;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.inventory_unit_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    v_error:=NULL;
    IF v_debt.sale_id IS NOT NULL AND COALESCE(NEW.unit_cost,0)>0 THEN
      BEGIN
        v_res:=public._fifo_adjust_sale_cogs_delta(
          v_debt.sale_id,
          v_take*COALESCE(NEW.unit_cost,0)
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
          v_error:=COALESCE(v_res->>'error','COGS_RECONCILIATION_FAILED');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_error:=SQLERRM;
      END;
    END IF;

    UPDATE public.inventory_unit_stock_debts
    SET settled_quantity=settled_quantity+v_take,
        reconciliation_status=CASE
          WHEN v_error IS NOT NULL THEN 'error'
          WHEN settled_quantity+v_take>=debt_quantity THEN 'settled'
          ELSE 'pending'
        END,
        reconciliation_error=v_error,
        updated_at=now()
    WHERE id=v_debt.id;

    v_remaining:=v_remaining-v_take;
  END LOOP;

  IF v_remaining IS DISTINCT FROM NEW.quantity THEN
    UPDATE public.inventory_unit_batches
    SET quantity=v_remaining
    WHERE id=NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._settle_product_stock_debt_on_batch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._settle_inventory_unit_stock_debt_on_batch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_settle_product_stock_debt_on_batch ON public.inventory_batches;
CREATE TRIGGER trg_settle_product_stock_debt_on_batch
AFTER INSERT ON public.inventory_batches
FOR EACH ROW EXECUTE FUNCTION public._settle_product_stock_debt_on_batch();

DROP TRIGGER IF EXISTS trg_settle_inventory_unit_stock_debt_on_batch ON public.inventory_unit_batches;
CREATE TRIGGER trg_settle_inventory_unit_stock_debt_on_batch
AFTER INSERT ON public.inventory_unit_batches
FOR EACH ROW EXECUTE FUNCTION public._settle_inventory_unit_stock_debt_on_batch();

-- Patch the current canonical sale-inventory core in-place. The replacements
-- are guarded so a drifted function fails the migration instead of silently
-- applying only part of the policy.
DO $patch$
DECLARE
  v_def text;
  v_next text;
BEGIN
  SELECT pg_get_functiondef(
    'public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)'::regprocedure
  ) INTO v_def;

  -- Re-applying this migration to a database where the policy patch already
  -- exists must be a safe no-op. This also makes recovery from interrupted
  -- DDL application deterministic.
  IF position('public.effective_allow_negative_stock' in v_def) > 0
     AND position('public._deduct_ready_product_stock_policy' in v_def) > 0
     AND position('public._deduct_inventory_unit_stock_policy' in v_def) > 0
     AND position('v_allow_negative' in v_def) > 0
     AND position('auth.uid(),v_allow_negative' in v_def) > 0 THEN
    RETURN;
  END IF;

  v_next:=replace(
    v_def,
    '  v_base_ready boolean := false;'||E'\n',
    '  v_base_ready boolean := false;'||E'\n  v_allow_negative boolean := false;\n'
  );
  IF v_next=v_def THEN RAISE EXCEPTION 'NEGATIVE_STOCK_PATCH_DECLARATION_DRIFT'; END IF;
  v_def:=v_next;

  v_next:=replace(
    v_def,
    $old$
  IF NOT public.is_pos_admin() AND v_user_branch IS NOT NULL AND v_user_branch<>p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_unit_need$old$,
    $new$
  IF NOT public.is_pos_admin() AND v_user_branch IS NOT NULL AND v_user_branch<>p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  v_allow_negative:=public.effective_allow_negative_stock(p_branch_id);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sale_unit_need$new$
  );
  IF v_next=v_def THEN RAISE EXCEPTION 'NEGATIVE_STOCK_PATCH_POLICY_DRIFT'; END IF;
  v_def:=v_next;

  v_next:=replace(
    v_def,
    $old$
  IF EXISTS(SELECT 1 FROM pg_temp.sale_unit_need WHERE required_qty<0) OR EXISTS(SELECT 1 FROM pg_temp.sale_raw_need WHERE required_qty<0) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_MODIFIER_INVENTORY_EFFECT','detail','Modifier removal exceeds the base component quantity.');
  END IF;

  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
  LOOP
    SELECT COALESCE(SUM(quantity),0) INTO v_available
    FROM public.inventory_batches
    WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
    IF v_available<v_link.required_qty THEN
      RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_READY_PRODUCT_STOCK','product_id',v_link.product_id,'required',v_link.required_qty,'available',v_available);
    END IF;
    v_need:=v_link.required_qty;
    FOR v_batch IN
      SELECT id,quantity,unit_cost,batch_number
      FROM public.inventory_batches
      WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0
      ORDER BY created_at,id FOR UPDATE
    LOOP
      EXIT WHEN v_need<=0;
      v_take:=LEAST(v_need,v_batch.quantity);
      UPDATE public.inventory_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
      v_need:=v_need-v_take;
      v_total_cost:=v_total_cost+(v_take*COALESCE(v_batch.unit_cost,0));
    END LOOP;
    v_ready:=v_ready||jsonb_build_object('product_id',v_link.product_id,'product_name',v_link.product_name,'quantity',v_link.required_qty);
  END LOOP;
$old$,
    $new$
  IF EXISTS(SELECT 1 FROM pg_temp.sale_unit_need WHERE required_qty<0) OR EXISTS(SELECT 1 FROM pg_temp.sale_raw_need WHERE required_qty<0) THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_MODIFIER_INVENTORY_EFFECT','detail','Modifier removal exceeds the base component quantity.');
  END IF;

  -- Strict mode validates all non-manufactured requirements before the first
  -- stock mutation so an explicit failure cannot leave a partial deduction.
  IF NOT v_allow_negative THEN
    FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.inventory_batches
      WHERE product_id=v_link.product_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_READY_PRODUCT_STOCK','product_id',v_link.product_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;

    FOR v_link IN SELECT * FROM pg_temp.sale_raw_need WHERE required_qty>0 ORDER BY raw_material_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.raw_material_batches
      WHERE raw_material_id=v_link.raw_material_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_RAW_MATERIAL_STOCK','raw_material_id',v_link.raw_material_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;

    FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type<>'manufactured' ORDER BY unit_id
    LOOP
      SELECT COALESCE(SUM(quantity),0) INTO v_available
      FROM public.inventory_unit_batches
      WHERE unit_id=v_link.unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
      IF v_available<v_link.required_qty THEN
        RETURN jsonb_build_object('success',false,'error','INSUFFICIENT_UNIT_STOCK','unit_id',v_link.unit_id,'required',v_link.required_qty,'available',v_available);
      END IF;
    END LOOP;
  END IF;

  FOR v_link IN SELECT * FROM pg_temp.sale_ready_need WHERE required_qty>0 ORDER BY product_id
  LOOP
    v_res:=public._deduct_ready_product_stock_policy(
      v_link.product_id,p_branch_id,p_warehouse_id,v_link.required_qty,
      p_reference_id,p_reference_number,v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_ready:=v_ready||jsonb_build_object(
      'product_id',v_link.product_id,
      'product_name',v_link.product_name,
      'quantity',v_link.required_qty,
      'oversold',COALESCE((v_res->>'oversold')::numeric,0)
    );
  END LOOP;
$new$
  );
  IF v_next=v_def THEN RAISE EXCEPTION 'NEGATIVE_STOCK_PATCH_READY_DRIFT'; END IF;
  v_def:=v_next;

  v_next:=replace(
    v_def,
    $old$
  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type='manufactured' ORDER BY unit_id
  LOOP
    PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 ORDER BY unit_id
  LOOP
    SELECT COALESCE(SUM(quantity),0) INTO v_available
    FROM public.inventory_unit_batches
    WHERE unit_id=v_link.unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id;
    IF v_available<v_link.required_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_UNIT_STOCK unit=% required=% available=%',v_link.unit_id,v_link.required_qty,v_available;
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 ORDER BY unit_id
  LOOP
    v_need:=v_link.required_qty;
    FOR v_batch IN
      SELECT id,quantity,unit_cost,batch_number
      FROM public.inventory_unit_batches
      WHERE unit_id=v_link.unit_id AND branch_id=p_branch_id AND warehouse_id=p_warehouse_id AND quantity>0
      ORDER BY created_at,id FOR UPDATE
    LOOP
      EXIT WHEN v_need<=0;
      v_take:=LEAST(v_need,v_batch.quantity);
      UPDATE public.inventory_unit_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
      INSERT INTO public.inventory_unit_entries(unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,reference_id,reference_number,batch_number,created_by)
      VALUES(v_link.unit_id,p_branch_id,p_warehouse_id,-v_take,v_batch.unit_cost,'sale','sale',p_reference_id,p_reference_number,v_batch.batch_number,auth.uid());
      v_need:=v_need-v_take;
      v_total_cost:=v_total_cost+(v_take*COALESCE(v_batch.unit_cost,0));
    END LOOP;
    v_units:=v_units||jsonb_build_object('unit_id',v_link.unit_id,'unit_name',v_link.unit_name,'unit_type',v_link.unit_type,'quantity',v_link.required_qty);
  END LOOP;
$old$,
    $new$
  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 AND unit_type='manufactured' ORDER BY unit_id
  LOOP
    IF v_allow_negative THEN
      BEGIN
        PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    ELSE
      PERFORM public._ensure_inventory_unit_stock(v_link.unit_id,v_link.required_qty,p_warehouse_id,p_branch_id,0);
    END IF;
  END LOOP;

  FOR v_link IN SELECT * FROM pg_temp.sale_unit_need WHERE required_qty>0 ORDER BY unit_id
  LOOP
    v_res:=public._deduct_inventory_unit_stock_policy(
      v_link.unit_id,p_branch_id,p_warehouse_id,v_link.required_qty,
      p_reference_id,p_reference_number,v_allow_negative
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    v_total_cost:=v_total_cost+COALESCE((v_res->>'total_cost')::numeric,0);
    v_units:=v_units||jsonb_build_object(
      'unit_id',v_link.unit_id,
      'unit_name',v_link.unit_name,
      'unit_type',v_link.unit_type,
      'quantity',v_link.required_qty,
      'oversold',COALESCE((v_res->>'oversold')::numeric,0)
    );
  END LOOP;
$new$
  );
  IF v_next=v_def THEN RAISE EXCEPTION 'NEGATIVE_STOCK_PATCH_UNIT_DRIFT'; END IF;
  v_def:=v_next;

  v_next:=replace(
    v_def,
    $old$
    v_res:=public._raw_remove_fifo(v_link.raw_material_id,p_branch_id,p_warehouse_id,v_link.required_qty,'sale','sale',p_reference_id,p_reference_number,auth.uid(),true);
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
$old$,
    $new$
    v_res:=public._raw_remove_fifo(v_link.raw_material_id,p_branch_id,p_warehouse_id,v_link.required_qty,'sale','sale',p_reference_id,p_reference_number,auth.uid(),v_allow_negative);
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_res; END IF;
    IF COALESCE((v_res->>'shortage')::numeric,0)>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','INSUFFICIENT_RAW_MATERIAL_STOCK',
        'raw_material_id',v_link.raw_material_id,
        'required',v_link.required_qty,
        'shortage',COALESCE((v_res->>'shortage')::numeric,0)
      );
    END IF;
$new$
  );
  IF v_next=v_def THEN RAISE EXCEPTION 'NEGATIVE_STOCK_PATCH_RAW_DRIFT'; END IF;
  v_def:=v_next;

  EXECUTE v_def;
END;
$patch$;

-- Preserve the existing external API surface; only the internal server policy
-- changes. Reassert the core helper's privileged boundary.
REVOKE ALL ON FUNCTION public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._deduct_sale_inventory_with_modifiers_core(uuid,uuid,jsonb,uuid,text)
  TO authenticated, service_role, postgres;
