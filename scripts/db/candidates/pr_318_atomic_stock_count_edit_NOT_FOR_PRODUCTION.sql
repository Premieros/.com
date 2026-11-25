-- Disposable candidate only; legacy product-only draft stock counts.
-- Row-level locks require UPDATE privilege, which is deliberately revoked from clients.
-- Keep the privileged operation in a non-exposed schema, lock only an authorized draft,
-- never change data or return protected rows, and retain the existing client table ACLs.
CREATE FUNCTION private.pr318_lock_stock_count_draft(p_count_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $count_lock$
DECLARE v_branch uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('inventory.count.create') IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNT_EDIT_DENIED';
  END IF;
  SELECT c.branch_id,c.status INTO v_branch,v_status
    FROM public.stock_counts c WHERE c.id=p_count_id
      AND public.user_may_access_branch(c.branch_id) IS TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'COUNT_NOT_DRAFT'; END IF;
END; $count_lock$;
REVOKE ALL ON FUNCTION private.pr318_lock_stock_count_draft(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.pr318_lock_stock_count_draft(uuid) TO authenticated;

CREATE FUNCTION public.pr318_edit_stock_count_candidate(p_count_id uuid,p_expected jsonb,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count public.stock_counts%ROWTYPE; v_snapshot jsonb; v_item record; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.can_permission('inventory.count.create') IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  PERFORM private.pr318_lock_stock_count_draft(p_count_id);
  SELECT * INTO v_count FROM public.stock_counts WHERE id=p_count_id;
  IF NOT FOUND OR public.user_may_access_branch(v_count.branch_id) IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_EDIT_DENIED'; END IF;
  IF v_count.status<>'draft' THEN RAISE EXCEPTION 'COUNT_NOT_DRAFT'; END IF;
  IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=p_count_id AND raw_material_id IS NOT NULL) THEN RAISE EXCEPTION 'RAW_COUNT_NOT_SUPPORTED'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_COUNT_LINES'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'counted_quantity',counted_quantity,'reason',reason) ORDER BY product_id),'[]'::jsonb) INTO v_snapshot FROM public.stock_count_items WHERE stock_count_id=p_count_id;
  IF v_snapshot IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'COUNT_REFRESH_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) i(product_id uuid,counted_quantity numeric,reason text)
    LEFT JOIN public.products p ON p.id=i.product_id AND p.branch_id=v_count.branch_id
    WHERE p.id IS NULL OR i.counted_quantity IS NULL OR i.counted_quantity<0 OR i.counted_quantity::text IN ('NaN','Infinity','-Infinity'))
    OR (SELECT count(DISTINCT i.product_id) FROM jsonb_to_recordset(p_items) i(product_id uuid))<>jsonb_array_length(p_items)
  THEN RAISE EXCEPTION 'INVALID_COUNT_LINES'; END IF;
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) i(product_id uuid,counted_quantity numeric,reason text) LOOP
    IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=p_count_id AND product_id=v_item.product_id) THEN
      v_result:=public.update_stock_count_item(p_count_id,v_item.product_id,v_item.counted_quantity,v_item.reason);
    ELSE
      v_result:=public.add_stock_count_item(p_count_id,v_item.product_id,v_item.counted_quantity,v_item.reason);
    END IF;
    IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_LINE_SAVE_FAILED: %',v_result; END IF;
  END LOOP;
  FOR v_item IN SELECT product_id FROM public.stock_count_items s WHERE s.stock_count_id=p_count_id AND NOT EXISTS
    (SELECT 1 FROM jsonb_to_recordset(p_items) i(product_id uuid) WHERE i.product_id=s.product_id) LOOP
    v_result:=public.remove_stock_count_item(p_count_id,v_item.product_id);
    IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'COUNT_LINE_REMOVE_FAILED: %',v_result; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.stock_count_items WHERE stock_count_id=p_count_id)<>jsonb_array_length(p_items)
     OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) i(product_id uuid,counted_quantity numeric,reason text) WHERE NOT EXISTS
       (SELECT 1 FROM public.stock_count_items s WHERE s.stock_count_id=p_count_id AND s.product_id=i.product_id AND s.counted_quantity=round(i.counted_quantity,4) AND s.reason IS NOT DISTINCT FROM i.reason))
  THEN RAISE EXCEPTION 'COUNT_LINES_NOT_SAVED'; END IF;
  RETURN jsonb_build_object('success',true,'items_count',jsonb_array_length(p_items));
END; $$;
REVOKE ALL ON FUNCTION public.pr318_edit_stock_count_candidate(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pr318_edit_stock_count_candidate(uuid,jsonb,jsonb) TO authenticated;
