CREATE OR REPLACE FUNCTION public.delivery_update_dispatch(p_branch uuid,p_order uuid,p_version integer,
  p_status text,p_service uuid DEFAULT NULL,p_driver uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_current qr_private.delivery_dispatch;
  v_kitchen_status text;
BEGIN
  PERFORM qr_private.require_staff(p_branch,'pos.order.edit');
  SELECT kitchen_status::text INTO v_kitchen_status FROM public.orders WHERE id=p_order AND branch_id=p_branch AND order_type='delivery'
    AND status IN ('open','held','completed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_ORDER_UNAVAILABLE'; END IF;
  SELECT * INTO v_current FROM qr_private.delivery_dispatch WHERE order_id=p_order AND branch_id=p_branch;
  IF p_version IS DISTINCT FROM coalesce(v_current.version,0) THEN RAISE EXCEPTION 'DELIVERY_REFRESH_REQUIRED'; END IF;
  IF v_current.status='delivered' THEN RAISE EXCEPTION 'DELIVERY_ALREADY_DELIVERED'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('waiting','assigned','on_the_way','delivered','failed')
     OR (p_status IN ('assigned','on_the_way','delivered') AND p_driver IS NULL AND p_service IS NULL) THEN
    RAISE EXCEPTION 'DELIVERY_ASSIGNMENT_REQUIRED';
  END IF;
  IF p_status IN ('on_the_way','delivered') AND (
    v_kitchen_status IS NULL OR v_kitchen_status NOT IN ('ready','served') OR EXISTS (
      SELECT 1 FROM public.order_items oi WHERE oi.order_id=p_order
        AND oi.quantity > COALESCE((SELECT sum(s.sent_quantity)
          FROM public.order_kitchen_sends s WHERE s.order_item_id=oi.id),0)
    )
  ) THEN
    RAISE EXCEPTION 'DELIVERY_PREPARATION_REQUIRED';
  END IF;
  IF p_driver IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qr_private.delivery_directory
    WHERE branch_id=p_branch AND id=p_driver AND kind='driver' AND (active OR id=v_current.driver_id)) THEN
    RAISE EXCEPTION 'DELIVERY_DRIVER_UNAVAILABLE';
  END IF;
  IF p_service IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qr_private.delivery_directory
    WHERE branch_id=p_branch AND id=p_service AND kind='service' AND (active OR id=v_current.service_id)) THEN
    RAISE EXCEPTION 'DELIVERY_SERVICE_UNAVAILABLE';
  END IF;
  INSERT INTO qr_private.delivery_dispatch(branch_id,order_id,service_id,driver_id,status,version,updated_by)
  VALUES(p_branch,p_order,p_service,p_driver,p_status,p_version+1,auth.uid())
  ON CONFLICT(order_id) DO UPDATE SET service_id=excluded.service_id,driver_id=excluded.driver_id,
    status=excluded.status,version=excluded.version,updated_at=now(),updated_by=excluded.updated_by;
  INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
  SELECT auth.uid(),u.email,'DELIVERY_DISPATCH_UPDATE','order',p_order,
    jsonb_build_object('previous_status',v_current.status,'status',p_status,'service_id',p_service,'driver_id',p_driver),p_branch
  FROM public.users u WHERE u.id=auth.uid();
  RETURN p_version+1;
END;
$$;
