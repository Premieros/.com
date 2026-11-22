CREATE TABLE qr_private.delivery_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('service','driver')),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone)<=32),
  active boolean NOT NULL DEFAULT true,
  UNIQUE(branch_id,id)
);
CREATE UNIQUE INDEX delivery_directory_unique_name ON qr_private.delivery_directory(branch_id,kind,lower(name));
CREATE TABLE qr_private.delivery_dispatch (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  service_id uuid,
  driver_id uuid,
  status text NOT NULL CHECK (status IN ('waiting','assigned','on_the_way','delivered','failed')),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  FOREIGN KEY (branch_id,service_id) REFERENCES qr_private.delivery_directory(branch_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (branch_id,driver_id) REFERENCES qr_private.delivery_directory(branch_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE qr_private.delivery_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_private.delivery_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.delivery_directory, qr_private.delivery_dispatch FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.delivery_workspace(p_branch uuid,p_history boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM qr_private.require_staff(p_branch,'pos.view');
  RETURN jsonb_build_object(
    'directory',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.active DESC,d.name)
      FROM qr_private.delivery_directory d WHERE d.branch_id=p_branch),'[]'::jsonb),
    'orders',coalesce((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.created_at DESC,rows.id)
      FROM (
        SELECT o.id,o.order_number,o.status AS order_status,o.created_at,o.total,
          coalesce(n.status,'waiting') AS dispatch_status,coalesce(n.version,0) AS version,
          n.service_id,n.driver_id,n.updated_at
        FROM public.orders o
        LEFT JOIN qr_private.delivery_dispatch n ON n.order_id=o.id AND n.branch_id=o.branch_id
        WHERE o.branch_id=p_branch AND o.order_type='delivery' AND (
          (p_history AND o.created_at>=now()-interval '30 days') OR
          (NOT p_history AND o.status IN ('open','held','completed') AND
            (n.status IN ('waiting','assigned','on_the_way') OR
              (n.order_id IS NULL AND (o.status IN ('open','held') OR o.created_at>=now()-interval '1 day'))))
        )
        ORDER BY o.created_at DESC,o.id LIMIT 100
      ) rows),'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.delivery_save_directory(p_branch uuid,p_kind text,p_name text,p_phone text DEFAULT '',
  p_id uuid DEFAULT NULL,p_active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM qr_private.require_staff(p_branch,'settings.manage');
  IF p_kind IS NULL OR p_kind NOT IN ('service','driver') OR coalesce(char_length(trim(p_name)),0) NOT BETWEEN 1 AND 100
    OR char_length(coalesce(p_phone,''))>32 OR p_active IS NULL THEN RAISE EXCEPTION 'INVALID_DELIVERY_ENTRY'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO qr_private.delivery_directory(branch_id,kind,name,phone,active)
    VALUES(p_branch,p_kind,trim(p_name),trim(coalesce(p_phone,'')),p_active) RETURNING id INTO v_id;
  ELSE
    UPDATE qr_private.delivery_directory SET name=trim(p_name),phone=trim(coalesce(p_phone,'')),active=p_active
    WHERE branch_id=p_branch AND id=p_id AND kind=p_kind RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_ENTRY_UNAVAILABLE'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.delivery_update_dispatch(p_branch uuid,p_order uuid,p_version integer,
  p_status text,p_service uuid DEFAULT NULL,p_driver uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_current qr_private.delivery_dispatch;
BEGIN
  PERFORM qr_private.require_staff(p_branch,'pos.order.edit');
  PERFORM 1 FROM public.orders WHERE id=p_order AND branch_id=p_branch AND order_type='delivery'
    AND status IN ('open','held','completed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_ORDER_UNAVAILABLE'; END IF;
  SELECT * INTO v_current FROM qr_private.delivery_dispatch WHERE order_id=p_order AND branch_id=p_branch;
  IF p_version IS DISTINCT FROM coalesce(v_current.version,0) THEN RAISE EXCEPTION 'DELIVERY_REFRESH_REQUIRED'; END IF;
  IF v_current.status='delivered' THEN RAISE EXCEPTION 'DELIVERY_ALREADY_DELIVERED'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('waiting','assigned','on_the_way','delivered','failed')
     OR (p_status IN ('assigned','on_the_way','delivered') AND p_driver IS NULL AND p_service IS NULL) THEN
    RAISE EXCEPTION 'DELIVERY_ASSIGNMENT_REQUIRED';
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

REVOKE ALL ON FUNCTION public.delivery_workspace(uuid,boolean),public.delivery_save_directory(uuid,text,text,text,uuid,boolean),
  public.delivery_update_dispatch(uuid,uuid,integer,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delivery_workspace(uuid,boolean),public.delivery_save_directory(uuid,text,text,text,uuid,boolean),
  public.delivery_update_dispatch(uuid,uuid,integer,text,uuid,uuid) TO authenticated;
