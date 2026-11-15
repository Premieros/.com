-- New raw-material oversales use an approved-price cost policy.
-- Legacy debts keep their existing FIFO reconciliation behavior; no historical
-- journal, stock or ledger value is rewritten by installing this migration.
-- New approved-price debts are quantity-settled on later receipts without
-- retrospectively revaluing the consumption ledger or reference journal.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';

ALTER TABLE public.raw_fifo_debts
 ADD COLUMN IF NOT EXISTS cost_policy text NOT NULL DEFAULT 'legacy_fifo';
ALTER TABLE public.raw_fifo_debts
 DROP CONSTRAINT IF EXISTS raw_fifo_debts_cost_policy_check;
ALTER TABLE public.raw_fifo_debts
 ADD CONSTRAINT raw_fifo_debts_cost_policy_check
 CHECK (cost_policy IN ('legacy_fifo','approved_price'));

CREATE OR REPLACE FUNCTION public._raw_price_oversold_batch_from_fifo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- New shortages use the branch's latest APPROVED price, including zero.
  -- Never rewrite already stored debt-batch values on an UPDATE.
  IF TG_OP='INSERT'
     AND NEW.quantity < 0
     AND COALESCE(NEW.source_type,'') LIKE '%_oversold' THEN
     NEW.unit_cost:=COALESCE(public._raw_cost_for_costing(
       NEW.raw_material_id,NEW.branch_id
     ),0);
  END IF;

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public._raw_remove_fifo(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_entry_type text DEFAULT 'production'::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_approved_unit_cost numeric(18,6):=0;
  v_batch record;
  v_deduct numeric(14,4);
  v_running numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0;
  v_branch_value numeric(18,4):=0;
  v_total_cost numeric(18,4):=0;
  v_total_removed numeric(14,4):=0;
  v_oversold numeric(14,4):=0;
  v_debt_batch text;
  v_debt_batch_id uuid;
  v_oversold_ledger_id bigint;
  v_oversold_created_at timestamptz;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object(
      'success',true,'shortage',0,'removed',0,'total_cost',0,'avg_cost',0
    );
  END IF;

  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_REQUIRED');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_running
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  -- Lock the cost used for THIS operation once. Batch selection only determines
  -- which warehouse quantity is consumed; its historic unit_cost is not the
  -- authoritative material costing price.
  v_approved_unit_cost:=COALESCE(
    public._raw_cost_for_costing(p_raw_material_id,p_branch_id),0
  );
  v_remaining:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY expiry_date NULLS LAST,created_at,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_deduct:=LEAST(v_batch.quantity,v_remaining);

    UPDATE public.raw_material_batches
    SET quantity=quantity-v_deduct
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,
      -v_deduct,v_approved_unit_cost,
      -v_deduct*v_approved_unit_cost,
      v_running,v_running-v_deduct,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    );

    v_running:=v_running-v_deduct;
    v_remaining:=v_remaining-v_deduct;
    v_total_removed:=v_total_removed+v_deduct;
    v_total_cost:=v_total_cost+v_deduct*v_approved_unit_cost;
  END LOOP;

  IF v_remaining>0 AND p_allow_negative THEN
    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,source_type,source_id
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,v_approved_unit_cost,NULL,NULL,
      COALESCE(NULLIF(p_reference_type,''),p_entry_type)||'_oversold',
      p_reference_id
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,v_approved_unit_cost,-v_remaining*v_approved_unit_cost,v_running,v_running-v_remaining,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    )
    RETURNING id,created_at INTO v_oversold_ledger_id,v_oversold_created_at;

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at,cost_policy
    ) VALUES (
      v_oversold_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,
      v_debt_batch_id,p_reference_type,p_reference_id,p_reference_number,
      v_remaining,0,v_oversold_created_at,'approved_price'
    )
    ON CONFLICT (source_ledger_id) DO NOTHING;

    v_total_removed:=v_total_removed+v_remaining;
    v_total_cost:=v_total_cost+v_remaining*v_approved_unit_cost;
    v_running:=v_running-v_remaining;
    v_oversold:=v_remaining;
    v_remaining:=0;
  END IF;

  SELECT
    COALESCE(SUM(quantity),0),
    COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;

  INSERT INTO public.raw_material_inventory(
    raw_material_id,branch_id,quantity,avg_cost
  ) VALUES (
    p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END
  )
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      avg_cost=EXCLUDED.avg_cost,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'shortage',v_remaining,
    'removed',v_total_removed,
    'total_cost',v_total_cost,
    'avg_cost',CASE
      WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2)
      ELSE 0
    END,
    'warehouse_id',p_warehouse_id,
    'oversold',v_oversold,
    'debt_batch_number',v_debt_batch,
    'fifo_debt_ledger_id',v_oversold_ledger_id
  );
END;
$function$

CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(p_receipt_ledger_id bigint, p_receipt_batch_id uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_receipt public.inventory_ledger%ROWTYPE;
  v_batch public.raw_material_batches%ROWTYPE;
  v_debt record;
  v_source public.inventory_ledger%ROWTYPE;
  v_take numeric(18,6);
  v_available numeric(18,6);
  v_delta numeric(18,6);
  v_settlement_id uuid;
  v_res jsonb;
  v_total_settled numeric(18,6):=0;
  v_total_value numeric(18,6):=0;
BEGIN
  SELECT * INTO v_receipt
  FROM public.inventory_ledger
  WHERE id=p_receipt_ledger_id
    AND raw_material_id IS NOT NULL
    AND quantity>0
  FOR SHARE;

  SELECT * INTO v_batch
  FROM public.raw_material_batches
  WHERE id=p_receipt_batch_id
  FOR UPDATE;

  IF v_receipt.id IS NULL OR v_batch.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_NOT_FOUND');
  END IF;

  IF v_batch.raw_material_id<>v_receipt.raw_material_id
     OR v_batch.branch_id<>v_receipt.branch_id
     OR v_batch.warehouse_id IS DISTINCT FROM v_receipt.warehouse_id THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_BATCH_MISMATCH');
  END IF;

  v_available:=LEAST(v_receipt.quantity,GREATEST(v_batch.quantity,0));

  FOR v_debt IN
    SELECT d.*
    FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=v_receipt.raw_material_id
      AND d.branch_id=v_receipt.branch_id
      AND d.warehouse_id=v_receipt.warehouse_id
      AND d.source_created_at<=v_receipt.created_at
      AND d.settled_quantity<d.debt_quantity
    ORDER BY d.source_created_at,d.source_ledger_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_available<=0;

    v_take:=LEAST(
      v_available,
      v_debt.debt_quantity-v_debt.settled_quantity
    );
    IF v_take<=0 THEN CONTINUE; END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    ) VALUES (
      v_debt.id,
      v_receipt.id,
      v_batch.id,
      v_take,
      CASE WHEN v_debt.cost_policy='approved_price' THEN 0 ELSE COALESCE(v_receipt.unit_cost,0) END,
      CASE WHEN v_debt.cost_policy='approved_price' THEN 0 ELSE v_take*COALESCE(v_receipt.unit_cost,0) END,
      p_run_id
    )
    ON CONFLICT (debt_id,receipt_ledger_id) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_debt.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL OR v_source.quantity>=0 THEN
      UPDATE public.raw_fifo_settlements
      SET reconciliation_status='error',
          reconciliation_error='FIFO_SOURCE_LEDGER_INVALID'
      WHERE id=v_settlement_id;
      CONTINUE;
    END IF;

    -- Old debts retain their historical FIFO reconciliation. New approved-price
    -- debts clear physical shortages only: never revalue their source journal.
    v_delta:=CASE WHEN v_debt.cost_policy='approved_price' THEN 0
                  ELSE v_take*COALESCE(v_receipt.unit_cost,0) END;

    UPDATE public.raw_fifo_debts
    SET settled_quantity=settled_quantity+v_take,
        updated_at=now()
    WHERE id=v_debt.id;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.raw_material_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_take,0)
    WHERE id=v_batch.id;

    IF v_debt.cost_policy <> 'approved_price' THEN
      UPDATE public.inventory_ledger
      SET total_cost=total_cost-v_delta,
          unit_cost=CASE
            WHEN quantity<0 THEN
              abs((total_cost-v_delta)/quantity)
            ELSE unit_cost
          END
      WHERE id=v_source.id;
    END IF;

    IF v_delta>0 THEN
      v_res:=public._fifo_adjust_reference_delta(
        v_source.reference_type,
        v_source.reference_id,
        v_source.branch_id,
        v_source.warehouse_id,
        'raw_material',
        v_source.raw_material_id,
        v_delta,
        0
      );

      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        UPDATE public.raw_fifo_settlements
        SET reconciliation_status='error',
            reconciliation_error=COALESCE(v_res->>'error','FIFO_REFERENCE_RECONCILIATION_FAILED')
        WHERE id=v_settlement_id;
      END IF;
    END IF;

    v_available:=v_available-v_take;
    v_total_settled:=v_total_settled+v_take;
    v_total_value:=v_total_value+v_delta;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'remaining_receipt_quantity',v_available
  );
END;
$function$
