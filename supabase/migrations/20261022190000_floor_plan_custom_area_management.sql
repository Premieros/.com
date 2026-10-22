-- Fix custom dining area lifecycle without permitting cross-tenant or direct unguarded deletion.
-- Default ("Main Area") names, membership, and delete protections remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS dining_areas_branch_normalized_name_uniq
ON public.dining_areas (branch_id, lower(btrim(name)));

CREATE OR REPLACE FUNCTION public.floor_plan_create_area(
  p_branch_id uuid, p_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_area_id uuid; v_name text := btrim(coalesce(p_name,'')); v_order integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.is_platform_admin()
    AND (NOT public.can_permission('floor_plan.manage') OR NOT public.user_may_access_branch(p_branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_NOT_FOUND');
  END IF;
  IF v_name='' OR length(v_name)>100 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_AREA_NAME');
  END IF;
  -- Serialize area numbering per branch and detect duplicate area names.
  PERFORM 1 FROM public.branches WHERE id=p_branch_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.dining_areas a
             WHERE a.branch_id=p_branch_id AND lower(btrim(a.name))=lower(v_name)) THEN
    RETURN jsonb_build_object('success',false,'error','AREA_NAME_EXISTS');
  END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_order
  FROM public.dining_areas WHERE branch_id=p_branch_id;
  INSERT INTO public.dining_areas(branch_id,name,sort_order,is_default,is_demo)
  VALUES(p_branch_id,v_name,v_order,false,false) RETURNING id INTO v_area_id;
  RETURN jsonb_build_object('success',true,'area_id',v_area_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','AREA_NAME_EXISTS');
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_plan_rename_area(
  p_area_id uuid, p_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_area public.dining_areas%ROWTYPE; v_name text := btrim(coalesce(p_name,''));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  SELECT * INTO v_area FROM public.dining_areas WHERE id=p_area_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','AREA_NOT_FOUND'); END IF;
  IF NOT public.is_platform_admin()
    AND (NOT public.can_permission('floor_plan.manage') OR NOT public.user_may_access_branch(v_area.branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF v_area.is_default THEN
    RETURN jsonb_build_object('success',false,'error','DEFAULT_AREA_FIXED');
  END IF;
  IF v_name='' OR length(v_name)>100 THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_AREA_NAME');
  END IF;
  IF EXISTS (SELECT 1 FROM public.dining_areas a WHERE a.branch_id=v_area.branch_id
             AND a.id<>p_area_id AND lower(btrim(a.name))=lower(v_name)) THEN
    RETURN jsonb_build_object('success',false,'error','AREA_NAME_EXISTS');
  END IF;
  UPDATE public.dining_areas SET name=v_name,updated_at=now() WHERE id=p_area_id;
  RETURN jsonb_build_object('success',true,'area_id',p_area_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success',false,'error','AREA_NAME_EXISTS');
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_plan_delete_area(p_area_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_area public.dining_areas%ROWTYPE; v_tables integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  SELECT * INTO v_area FROM public.dining_areas WHERE id=p_area_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','AREA_NOT_FOUND'); END IF;
  IF NOT public.is_platform_admin()
    AND (NOT public.can_permission('floor_plan.manage') OR NOT public.user_may_access_branch(v_area.branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  IF v_area.is_default THEN
    RETURN jsonb_build_object('success',false,'error','DEFAULT_AREA_FIXED');
  END IF;
  SELECT count(*) INTO v_tables FROM public.dining_tables WHERE area_id=p_area_id;
  IF v_tables>0 THEN
    RETURN jsonb_build_object('success',false,'error','AREA_HAS_TABLES','tables',v_tables);
  END IF;
  DELETE FROM public.dining_areas WHERE id=p_area_id AND NOT is_default;
  RETURN jsonb_build_object('success',true,'deleted',true,'area_id',p_area_id);
EXCEPTION WHEN foreign_key_violation THEN
  RETURN jsonb_build_object('success',false,'error','AREA_HAS_REFERENCES');
END;
$$;

REVOKE ALL ON FUNCTION public.floor_plan_create_area(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.floor_plan_rename_area(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.floor_plan_delete_area(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_create_area(uuid,text),
  public.floor_plan_rename_area(uuid,text),
  public.floor_plan_delete_area(uuid) TO authenticated;

COMMENT ON FUNCTION public.floor_plan_delete_area(uuid)
IS 'Only authorized floor-plan managers can delete a custom area with zero tables, scoped to its branch. Main area and its 50 canonical tables are protected.';
