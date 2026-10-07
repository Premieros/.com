-- Customer support chat for tenant users and platform Super Admin.
-- Tables are not directly exposed to authenticated clients; all access goes
-- through guarded RPCs so message sender identity cannot be spoofed.

CREATE TABLE IF NOT EXISTS public.support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  subject text NOT NULL DEFAULT 'Support',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  closed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_support_conversations_org_last
  ON public.support_conversations(organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_creator_last
  ON public.support_conversations(created_by, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_status_last
  ON public.support_conversations(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  sender_kind text NOT NULL CHECK (sender_kind IN ('customer','support')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_created
  ON public.support_messages(conversation_id, created_at ASC);

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.support_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.support_conversations TO service_role;
GRANT ALL ON public.support_messages TO service_role;

CREATE OR REPLACE FUNCTION public.support_open_conversation(
  p_branch_id uuid,
  p_subject text,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_conversation_id uuid;
  v_subject text := left(COALESCE(NULLIF(btrim(p_subject), ''), 'Support'), 160);
  v_message text := btrim(COALESCE(p_message, ''));
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF char_length(v_message) < 1 OR char_length(v_message) > 4000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'MESSAGE_INVALID');
  END IF;

  IF p_branch_id IS NOT NULL THEN
    IF NOT public.user_may_access_branch(p_branch_id) AND NOT public.is_super_admin() THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
    END IF;
    SELECT b.organization_id INTO v_org_id
    FROM public.branches b
    WHERE b.id = p_branch_id AND b.is_active = true;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT om.organization_id INTO v_org_id
    FROM public.organization_members om
    WHERE om.user_id = v_user_id AND om.is_active = true
    ORDER BY om.created_at
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT b.organization_id INTO v_org_id
    FROM public.users u
    JOIN public.branches b ON b.id = u.branch_id
    WHERE u.id = v_user_id AND u.is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL OR (NOT public.user_can_access_organization(v_org_id) AND NOT public.is_super_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORGANIZATION_ACCESS_DENIED');
  END IF;

  INSERT INTO public.support_conversations(
    organization_id, branch_id, created_by, subject, status, last_message_at
  ) VALUES (
    v_org_id, p_branch_id, v_user_id, v_subject, 'open', now()
  )
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.support_messages(
    conversation_id, sender_user_id, sender_kind, body
  ) VALUES (
    v_conversation_id, v_user_id,
    CASE WHEN public.is_super_admin() THEN 'support' ELSE 'customer' END,
    v_message
  );

  -- Automatic acknowledgement visible in the same conversation.
  -- We intentionally attribute it to the customer user id with sender_kind=support
  -- instead of inventing a fake auth identity.
  IF NOT public.is_super_admin() THEN
    INSERT INTO public.support_messages(
      conversation_id, sender_user_id, sender_kind, body
    ) VALUES (
      v_conversation_id,
      v_user_id,
      'support',
      'استلمنا رسالتك، سيتم الرد عليك في أقرب وقت.'
    );

    UPDATE public.support_conversations
    SET last_message_at = now(), updated_at = now()
    WHERE id = v_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'conversation_id', v_conversation_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_list_my_conversations()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED')
    ELSE jsonb_build_object(
      'success', true,
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'subject', c.subject,
            'status', c.status,
            'organization_id', c.organization_id,
            'branch_id', c.branch_id,
            'branch_name', b.name,
            'last_message_at', c.last_message_at,
            'created_at', c.created_at
          )
          ORDER BY c.last_message_at DESC
        )
        FROM public.support_conversations c
        LEFT JOIN public.branches b ON b.id = c.branch_id
        WHERE c.created_by = auth.uid()
      ), '[]'::jsonb)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.support_list_all_conversations(
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open','closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATUS_INVALID');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_message_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id,
      c.subject,
      c.status,
      c.organization_id,
      o.name AS organization_name,
      c.branch_id,
      b.name AS branch_name,
      c.created_by,
      u.full_name AS customer_name,
      u.email AS customer_email,
      c.last_message_at,
      c.created_at,
      c.closed_at
    FROM public.support_conversations c
    JOIN public.organizations o ON o.id = c.organization_id
    LEFT JOIN public.branches b ON b.id = c.branch_id
    LEFT JOIN public.users u ON u.id = c.created_by
    WHERE p_status IS NULL OR c.status = p_status
  ) x;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_get_messages(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_allowed boolean := false;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT public.is_super_admin() OR c.created_by = auth.uid()
  INTO v_allowed
  FROM public.support_conversations c
  WHERE c.id = p_conversation_id;

  IF COALESCE(v_allowed, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONVERSATION_ACCESS_DENIED');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'conversation_id', m.conversation_id,
      'sender_user_id', m.sender_user_id,
      'sender_kind', m.sender_kind,
      'sender_name', u.full_name,
      'body', m.body,
      'created_at', m.created_at
    )
    ORDER BY m.created_at ASC
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.support_messages m
  LEFT JOIN public.users u ON u.id = m.sender_user_id
  WHERE m.conversation_id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_send_message(
  p_conversation_id uuid,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_allowed boolean := false;
  v_status text;
  v_message text := btrim(COALESCE(p_message, ''));
  v_message_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF char_length(v_message) < 1 OR char_length(v_message) > 4000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'MESSAGE_INVALID');
  END IF;

  SELECT public.is_super_admin() OR c.created_by = v_user_id, c.status
  INTO v_allowed, v_status
  FROM public.support_conversations c
  WHERE c.id = p_conversation_id
  FOR UPDATE;

  IF COALESCE(v_allowed, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONVERSATION_ACCESS_DENIED');
  END IF;
  IF v_status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONVERSATION_CLOSED');
  END IF;

  INSERT INTO public.support_messages(
    conversation_id, sender_user_id, sender_kind, body
  ) VALUES (
    p_conversation_id,
    v_user_id,
    CASE WHEN public.is_super_admin() THEN 'support' ELSE 'customer' END,
    v_message
  )
  RETURNING id INTO v_message_id;

  UPDATE public.support_conversations
  SET last_message_at = now(), updated_at = now()
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('success', true, 'message_id', v_message_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_set_conversation_status(
  p_conversation_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_status NOT IN ('open','closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'STATUS_INVALID');
  END IF;

  UPDATE public.support_conversations
  SET status = p_status,
      updated_at = now(),
      closed_at = CASE WHEN p_status = 'closed' THEN now() ELSE NULL END,
      closed_by = CASE WHEN p_status = 'closed' THEN auth.uid() ELSE NULL END
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONVERSATION_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$function$;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.support_open_conversation(uuid,text,text)'::regprocedure,
    'public.support_list_my_conversations()'::regprocedure,
    'public.support_list_all_conversations(text)'::regprocedure,
    'public.support_get_messages(uuid)'::regprocedure,
    'public.support_send_message(uuid,text)'::regprocedure,
    'public.support_set_conversation_status(uuid,text)'::regprocedure
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
