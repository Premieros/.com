-- Voluntary customer-experience feedback for accepted QR guest orders.
-- Private, branch-scoped and visit-bound. Never infer CRM identity from a phone.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE TABLE qr_private.guest_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES qr_private.visits(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  overall smallint NOT NULL CHECK (overall BETWEEN 1 AND 5),
  food smallint NOT NULL CHECK (food BETWEEN 1 AND 5),
  service smallint NOT NULL CHECK (service BETWEEN 1 AND 5),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_ratings_branch_created ON qr_private.guest_ratings(branch_id, created_at DESC);
ALTER TABLE qr_private.guest_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_private.guest_ratings FROM PUBLIC, anon, authenticated;

CREATE FUNCTION qr_private.rating_visit(p_token text, p_session text)
RETURNS qr_private.visits LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l qr_private.table_links; v qr_private.visits; h text;
BEGIN
  l := qr_private.guest_scope(p_token, p_session);
  h := encode(sha256(convert_to(p_session,'UTF8')), 'hex');
  SELECT * INTO v FROM qr_private.visits
  WHERE branch_id = l.branch_id AND generation = l.generation
    AND guest_hash = h AND expires_at > now()
    AND created_at > now() - interval '24 hours';
  IF v.id IS NULL THEN RAISE EXCEPTION 'QR_CHECKIN_REQUIRED'; END IF;
  RETURN v;
END $$;

CREATE FUNCTION qr_private.read_guest_rating(p_token text, p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v qr_private.visits; r qr_private.guest_ratings; eligible boolean;
BEGIN
  v := qr_private.rating_visit(p_token, p_session);
  SELECT * INTO r FROM qr_private.guest_ratings WHERE visit_id = v.id;
  SELECT EXISTS(SELECT 1 FROM qr_private.requests
    WHERE visit_id = v.id AND branch_id = v.branch_id AND status = 'accepted')
    INTO eligible;
  RETURN jsonb_build_object(
    'eligible',eligible AND v.status <> 'closed',
    'submitted',r.id IS NOT NULL,
    'overall',r.overall,'food',r.food,'service',r.service,'note',r.note);
END $$;

CREATE FUNCTION qr_private.submit_guest_rating(
  p_token text, p_session text, p_overall integer,
  p_food integer, p_service integer, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v qr_private.visits; r qr_private.guest_ratings; clean_note text;
BEGIN
  v := qr_private.rating_visit(p_token, p_session);
  IF v.status = 'closed' OR NOT EXISTS(
    SELECT 1 FROM qr_private.requests
    WHERE visit_id = v.id AND branch_id = v.branch_id AND status = 'accepted'
  ) THEN RAISE EXCEPTION 'QR_RATING_NOT_AVAILABLE'; END IF;
  IF p_overall IS NULL OR p_overall NOT BETWEEN 1 AND 5
    OR p_food IS NULL OR p_food NOT BETWEEN 1 AND 5
    OR p_service IS NULL OR p_service NOT BETWEEN 1 AND 5
  THEN RAISE EXCEPTION 'QR_RATING_INVALID'; END IF;
  clean_note := trim(coalesce(p_note,''));
  IF char_length(clean_note) > 300 OR clean_note ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'QR_RATING_INVALID'; END IF;
  -- One immutable response per visit, safe if a client retries after network loss.
  INSERT INTO qr_private.guest_ratings (visit_id,branch_id,overall,food,service,note)
  VALUES (v.id,v.branch_id,p_overall,p_food,p_service,clean_note)
  ON CONFLICT (visit_id) DO NOTHING;
  SELECT * INTO r FROM qr_private.guest_ratings WHERE visit_id = v.id;
  RETURN jsonb_build_object(
    'submitted',true,'overall',r.overall,'food',r.food,'service',r.service,'note',r.note);
END $$;

CREATE FUNCTION qr_private.branch_guest_ratings(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE total integer; avg_score numeric; latest jsonb;
BEGIN
  PERFORM qr_private.require_staff(p_branch, 'pos.view');
  SELECT count(*), round(avg(overall)::numeric, 2)
  INTO total,avg_score FROM qr_private.guest_ratings WHERE branch_id=p_branch;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb)
  INTO latest FROM (
    SELECT overall,food,service,note,created_at
    FROM qr_private.guest_ratings WHERE branch_id=p_branch
    ORDER BY created_at DESC LIMIT 20
  ) t;
  RETURN jsonb_build_object('count',total,'average',avg_score,'recent',latest);
END $$;

-- Public entry points only, private tables remain completely inaccessible.
CREATE FUNCTION public.qr_guest_rating(p_token text,p_session text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT qr_private.read_guest_rating(p_token,p_session) $$;
CREATE FUNCTION public.qr_guest_rate(p_token text,p_session text,p_overall integer,p_food integer,p_service integer,p_note text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT qr_private.submit_guest_rating(p_token,p_session,p_overall,p_food,p_service,p_note) $$;
CREATE FUNCTION public.qr_branch_ratings(p_branch uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT qr_private.branch_guest_ratings(p_branch) $$;

REVOKE ALL ON FUNCTION qr_private.rating_visit(text,text),qr_private.read_guest_rating(text,text),
  qr_private.submit_guest_rating(text,text,integer,integer,integer,text),
  qr_private.branch_guest_ratings(uuid),
  public.qr_guest_rating(text,text),public.qr_guest_rate(text,text,integer,integer,integer,text),
  public.qr_branch_ratings(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.read_guest_rating(text,text),
  qr_private.submit_guest_rating(text,text,integer,integer,integer,text),
  public.qr_guest_rating(text,text),public.qr_guest_rate(text,text,integer,integer,integer,text)
  TO anon,authenticated;
GRANT EXECUTE ON FUNCTION qr_private.branch_guest_ratings(uuid),public.qr_branch_ratings(uuid)
  TO authenticated;
