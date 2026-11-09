-- Already-applied Premier production SQL restored verbatim for disposable CI replay.
-- Production migration 20261023120442; DO NOT manually reapply to production.
ALTER TABLE private.raw_warehouse_movements_v2
 ADD COLUMN IF NOT EXISTS entry_type text,
 ADD COLUMN IF NOT EXISTS source_reference_type text,
 ADD COLUMN IF NOT EXISTS source_reference_id uuid;
CREATE OR REPLACE FUNCTION private.apply_raw_warehouse_delta_document_v3(
 p_operation_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_raw_material_id uuid,
 p_delta numeric,p_allow_negative boolean,
 p_entry_type text,p_reference_type text,p_reference_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v_result jsonb; v_record private.raw_warehouse_movements_v2%ROWTYPE;
BEGIN
 IF p_entry_type IS NULL OR p_entry_type NOT IN
  ('sale','kitchen_send','kitchen_void','purchase','purchase_return','production','refund','transfer','adjustment','opening')
  OR p_reference_type IS NULL OR p_reference_type NOT IN
  ('sale','kitchen_send','purchase','purchase_return','production','warehouse_transfer','opening_inventory','stock_count','manual_adjustment')
  OR p_reference_id IS NULL THEN
  RETURN jsonb_build_object('success',false,'error','INVALID_DOCUMENT_REFERENCE');
 END IF;
 IF coalesce(current_setting('premieros.v2_movement_test',true),'') <> 'enabled' THEN
  RETURN jsonb_build_object('success',false,'error','CUTOVER_NOT_ENABLED');
 END IF;
 v_result:=private.apply_raw_warehouse_delta_v2(
 p_operation_id,p_branch_id,p_warehouse_id,p_raw_material_id,p_delta,p_allow_negative);
 IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_result; END IF;
 SELECT * INTO v_record FROM private.raw_warehouse_movements_v2 WHERE operation_id=p_operation_id FOR UPDATE;
 IF v_record.entry_type IS NOT NULL AND
 (v_record.entry_type<>p_entry_type OR v_record.source_reference_type<>p_reference_type OR
  v_record.source_reference_id<>p_reference_id) THEN
  RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_DOCUMENT_CONFLICT');
 END IF;
 IF v_record.entry_type IS NULL THEN
  UPDATE private.raw_warehouse_movements_v2
   SET entry_type=p_entry_type,source_reference_type=p_reference_type,
       source_reference_id=p_reference_id WHERE operation_id=p_operation_id;
  UPDATE public.inventory_ledger
   SET entry_type=p_entry_type,reference_type=p_reference_type,reference_id=p_reference_id
   WHERE id=v_record.ledger_id AND reference_type='warehouse_movement_v2'
    AND reference_id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_V2_LEDGER_ROW'; END IF;
 END IF;
 RETURN v_result || jsonb_build_object('entry_type',p_entry_type,'reference_type',p_reference_type,
  'reference_id',p_reference_id);
END;
$$;
REVOKE ALL ON FUNCTION private.apply_raw_warehouse_delta_document_v3(uuid,uuid,uuid,uuid,numeric,boolean,text,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.apply_raw_warehouse_delta_document_v3(uuid,uuid,uuid,uuid,numeric,boolean,text,text,uuid)
 TO service_role;
