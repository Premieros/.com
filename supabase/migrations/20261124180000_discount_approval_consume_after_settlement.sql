-- Draft migration, verify only in disposable CI.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Preserve the existing SELECT ... FOR UPDATE authorization lock, but defer
-- the state transition and audit entry until the financial operation succeeds.
DO $migration$
DECLARE
  normal_target constant regprocedure := 'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure;
  split_target constant regprocedure := 'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure;
  definition text;
  normal_consume constant text := $normal$
    UPDATE public.approval_requests
    SET status='consumed', consumed_at=now()
    WHERE id=v_req_id;

    SELECT email INTO v_email FROM public.users WHERE id=auth.uid();
    INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
    VALUES(
      auth.uid(),v_email,'APPROVAL_CONSUMED','approval_request',v_req_id,
      jsonb_build_object('action_type','discount','discount_amount',v_header_discount,'order_id',p_order_id),
      p_branch_id
    );$normal$;
  split_consume constant text := $split$
      UPDATE public.approval_requests SET status='consumed',consumed_at=now() WHERE id=v_req_id;
      SELECT email INTO v_email FROM public.users WHERE id=auth.uid();
      INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
      VALUES(auth.uid(),v_email,'APPROVAL_CONSUMED','approval_request',v_req_id,
        jsonb_build_object('action_type','discount','discount_amount',p_discount_amount,'discount_type',p_discount_type,
          'server_subtotal',v_server_subtotal,'order_id',p_order_id),p_branch_id);$split$;
  normal_end constant text := E'\n  RETURN v_result;\nEND;';
  split_end constant text := '    RETURN v_core || jsonb_build_object(';
  normal_amount constant text := 'AND abs(COALESCE((payload->>''discount_amount'')::numeric,-1) - v_header_discount) < 0.0001';
BEGIN
  definition := pg_get_functiondef(normal_target);
  IF strpos(definition,normal_consume)=0 OR strpos(definition,normal_end)=0 OR strpos(definition,normal_amount)=0 THEN
    RAISE EXCEPTION 'Normal settlement approval contract changed';
  END IF;
  definition := replace(definition, normal_consume, '');
  -- The canonical normal settlement previously checked monetary discount,
  -- but not the approved subtotal. Linked orders may settle only sent lines;
  -- require an exact subtotal for unlinked sales, where the cart is matched.
  definition := replace(definition, normal_amount, normal_amount ||
    E'\n      AND (p_order_id IS NOT NULL OR abs(COALESCE((payload->>''subtotal'')::numeric,-1)-v_server_subtotal)<0.0001)');
  EXECUTE replace(definition, normal_end, E'\n  IF v_req_id IS NOT NULL AND COALESCE((v_result->>''success'')::boolean,false) IS TRUE THEN' ||
    normal_consume || E'\n  END IF;\n' || normal_end);

  definition := pg_get_functiondef(split_target);
  IF strpos(definition,split_consume)=0 OR strpos(definition,split_end)=0 THEN
    RAISE EXCEPTION 'Split settlement approval contract changed';
  END IF;
  definition := replace(definition,split_consume,'');
  EXECUTE replace(definition,split_end,'    IF v_req_id IS NOT NULL THEN' ||
    split_consume || E'\n    END IF;\n\n' || split_end);
END;
$migration$;
