CREATE TABLE qr_private.customer_support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  code_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('complaint','inquiry')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_support_branch_created ON qr_private.customer_support_threads(branch_id,created_at DESC);
CREATE TABLE qr_private.customer_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES qr_private.customer_support_threads(id),
  from_staff boolean NOT NULL,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_support_thread_messages ON qr_private.customer_support_messages(thread_id,created_at);
ALTER TABLE qr_private.customer_support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_private.customer_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.customer_support_threads, qr_private.customer_support_messages FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.customer_support_qr_branch(p_token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (qr_private.guest_scope(p_token,repeat('0',64))).branch_id
$$;

CREATE FUNCTION public.customer_support_start(p_branch uuid,p_kind text,p_body text,p_code text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_code text := coalesce(p_code,replace(gen_random_uuid()::text,'-',''));
  v_hash text := encode(sha256(convert_to(v_code,'UTF8')),'hex');
  v_thread uuid;
BEGIN
  IF v_code !~ '^[0-9a-f]{32}$' OR p_kind IS NULL OR p_kind NOT IN ('complaint','inquiry') OR
     coalesce(char_length(trim(p_body)),0) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_SUPPORT_MESSAGE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b JOIN public.organizations o ON b.organization_id=o.id
    WHERE b.id=p_branch AND b.is_active AND o.is_active) THEN RAISE EXCEPTION 'SUPPORT_BRANCH_UNAVAILABLE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('customer-support:'||p_branch::text,0));
  SELECT id INTO v_thread FROM qr_private.customer_support_threads
    WHERE branch_id=p_branch AND code_hash=v_hash AND kind=p_kind;
  IF v_thread IS NOT NULL THEN
    IF (SELECT body FROM qr_private.customer_support_messages WHERE thread_id=v_thread
      ORDER BY created_at,id LIMIT 1) IS DISTINCT FROM trim(p_body) THEN
      RAISE EXCEPTION 'SUPPORT_MESSAGE_CHANGED';
    END IF;
    RETURN v_code;
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM qr_private.customer_support_threads
      WHERE branch_id=p_branch AND created_at>now()-interval '1 minute' LIMIT 60) recent) >= 60 THEN
    RAISE EXCEPTION 'SUPPORT_TRY_LATER';
  END IF;
  INSERT INTO qr_private.customer_support_threads(branch_id,code_hash,kind)
    VALUES(p_branch,v_hash,p_kind) RETURNING id INTO v_thread;
  INSERT INTO qr_private.customer_support_messages(thread_id,from_staff,body) VALUES(v_thread,false,trim(p_body));
  RETURN v_code;
END;
$$;

CREATE FUNCTION public.customer_support_follow(p_branch uuid,p_code text,p_body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_thread uuid;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'SUPPORT_CODE_INVALID'; END IF;
  IF p_body IS NULL THEN
    SELECT id INTO v_thread FROM qr_private.customer_support_threads
      WHERE branch_id=p_branch AND code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex');
  ELSE
    SELECT id INTO v_thread FROM qr_private.customer_support_threads
      WHERE branch_id=p_branch AND code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') FOR UPDATE;
  END IF;
  IF v_thread IS NULL THEN RAISE EXCEPTION 'SUPPORT_CODE_INVALID'; END IF;
  IF p_body IS NOT NULL THEN
    IF char_length(trim(p_body)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_SUPPORT_MESSAGE'; END IF;
    IF (SELECT count(*) FROM qr_private.customer_support_messages WHERE thread_id=v_thread)>=200 THEN
      RAISE EXCEPTION 'SUPPORT_THREAD_LIMIT';
    END IF;
    INSERT INTO qr_private.customer_support_messages(thread_id,from_staff,body) VALUES(v_thread,false,trim(p_body));
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'from_staff',from_staff,'body',body,'created_at',created_at)
    ORDER BY created_at,id) FROM qr_private.customer_support_messages WHERE thread_id=v_thread),'[]'::jsonb);
END;
$$;

CREATE FUNCTION public.customer_support_staff_list(p_branch uuid,p_before uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM qr_private.require_staff(p_branch,'customers.manage');
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.created_at DESC,rows.id DESC) FROM (
    SELECT t.id,t.kind,t.created_at,m.body AS latest_message,m.from_staff AS answered
    FROM qr_private.customer_support_threads t
    CROSS JOIN LATERAL (SELECT body,from_staff FROM qr_private.customer_support_messages WHERE thread_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) m
    WHERE t.branch_id=p_branch AND (p_before IS NULL OR (t.created_at,t.id) <
      (SELECT old.created_at,old.id FROM qr_private.customer_support_threads old WHERE old.branch_id=p_branch AND old.id=p_before))
    ORDER BY t.created_at DESC,t.id DESC LIMIT 30
  ) rows),'[]'::jsonb);
END;
$$;

CREATE FUNCTION public.customer_support_staff_thread(p_branch uuid,p_thread uuid,p_body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_thread uuid;
BEGIN
  PERFORM qr_private.require_staff(p_branch,'customers.manage');
  SELECT id INTO v_thread FROM qr_private.customer_support_threads WHERE branch_id=p_branch AND id=p_thread FOR UPDATE;
  IF v_thread IS NULL THEN RAISE EXCEPTION 'SUPPORT_THREAD_UNAVAILABLE'; END IF;
  IF p_body IS NOT NULL THEN
    IF char_length(trim(p_body)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_SUPPORT_MESSAGE'; END IF;
    IF (SELECT count(*) FROM qr_private.customer_support_messages WHERE thread_id=v_thread)>=200 THEN
      RAISE EXCEPTION 'SUPPORT_THREAD_LIMIT';
    END IF;
    INSERT INTO qr_private.customer_support_messages(thread_id,from_staff,body) VALUES(v_thread,true,trim(p_body));
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'from_staff',from_staff,'body',body,'created_at',created_at)
    ORDER BY created_at,id) FROM qr_private.customer_support_messages WHERE thread_id=v_thread),'[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_support_qr_branch(text), public.customer_support_start(uuid,text,text,text),
  public.customer_support_follow(uuid,text,text), public.customer_support_staff_list(uuid,uuid),
  public.customer_support_staff_thread(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_support_qr_branch(text), public.customer_support_start(uuid,text,text,text),
  public.customer_support_follow(uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_support_staff_list(uuid,uuid),
  public.customer_support_staff_thread(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.branch_contact_links(p_branch uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT jsonb_build_object('facebook',l.facebook_url,'instagram',l.instagram_url,
    'whatsapp',l.whatsapp_url,'tiktok',l.tiktok_url,'website',l.website_url)
  FROM public.branch_website_links l JOIN public.branches b ON b.id=l.branch_id AND b.is_active
  JOIN public.organizations o ON o.id=b.organization_id AND o.is_active WHERE l.branch_id=p_branch),'{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.branch_contact_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branch_contact_links(uuid) TO anon,authenticated;

-- Reuse the existing social settings and URL validation for website editors.
DO $$
DECLARE v_fn regprocedure; v_definition text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.branch_website_links_settings(uuid)'::regprocedure,
                              'public.branch_website_links_save(uuid,jsonb)'::regprocedure] LOOP
    v_definition := pg_get_functiondef(v_fn);
    IF strpos(v_definition,'perform qr_private.require_settings(p_branch);')=0 THEN
      RAISE EXCEPTION 'WEBSITE_LINKS_GUARD_CHANGED';
    END IF;
    EXECUTE replace(v_definition,'perform qr_private.require_settings(p_branch);',
      'if public.can_permission(''website.edit'') then perform qr_private.require_website(p_branch);
       else perform qr_private.require_settings(p_branch); end if;');
  END LOOP;
END;
$$;
