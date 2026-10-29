CREATE FUNCTION public.validate_branch_hub_payload_v1(p_event_id uuid,p_branch_id uuid,p_payload_text text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE payload jsonb; revenue numeric; bad boolean;
BEGIN
 IF p_event_id IS NULL OR p_branch_id IS NULL OR p_payload_text IS NULL OR octet_length(p_payload_text)>65536 THEN RETURN false; END IF;
 payload:=p_payload_text::jsonb;
 IF jsonb_typeof(payload)!='object' OR payload->>'saleId' IS DISTINCT FROM p_event_id::text OR payload->>'branchId' IS DISTINCT FROM p_branch_id::text
 OR jsonb_typeof(payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 100
 OR coalesce(payload->>'paymentAccount','') NOT IN ('cash','bank') OR coalesce(length(payload->>'key'),0) NOT BETWEEN 8 AND 160
 OR jsonb_typeof(payload->'totalMinor') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_HUB_EVENT'; END IF;
 SELECT sum((l->>'quantity')::numeric*(l->>'priceMinor')::numeric), bool_or(
   coalesce(l->>'sku','') !~ '^[a-zA-Z0-9_.-]{1,80}$'
   OR jsonb_typeof(l->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(l->'priceMinor') IS DISTINCT FROM 'number'
   OR jsonb_typeof(l->'costMinor') IS DISTINCT FROM 'number'
   OR (l->>'quantity')::numeric NOT BETWEEN 1 AND 9007199254740991 OR trunc((l->>'quantity')::numeric)!=(l->>'quantity')::numeric
   OR (l->>'priceMinor')::numeric NOT BETWEEN 1 AND 9007199254740991 OR trunc((l->>'priceMinor')::numeric)!=(l->>'priceMinor')::numeric
   OR (l->>'costMinor')::numeric NOT BETWEEN 0 AND 9007199254740991 OR trunc((l->>'costMinor')::numeric)!=(l->>'costMinor')::numeric)
 INTO revenue,bad FROM jsonb_array_elements(payload->'lines') l;
 IF bad OR revenue!=(payload->>'totalMinor')::numeric OR revenue NOT BETWEEN 1 AND 9007199254740991 OR
 (SELECT count(DISTINCT l->>'sku') FROM jsonb_array_elements(payload->'lines')l)!=jsonb_array_length(payload->'lines') THEN RAISE EXCEPTION 'INVALID_HUB_AMOUNTS'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.validate_branch_hub_payload_v1(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_branch_hub_payload_v1(uuid,uuid,text) TO authenticated;

-- Branch Hub transport replication only. Receiving an event NEVER posts into canonical ERP ledgers.
-- Additive, invoker-only, immutable financial payloads; no changes to existing business tables.
CREATE TABLE public.branch_hub_replicated_sales (
 event_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 installation_id uuid NOT NULL,
 checkout_key text NOT NULL CHECK(length(checkout_key) BETWEEN 8 AND 160),
 payload_text text NOT NULL CHECK(public.validate_branch_hub_payload_v1(event_id,branch_id,payload_text)),
 payload_sha256 text NOT NULL CHECK(payload_sha256=encode(sha256(convert_to(payload_text,'UTF8')),'hex')),
 received_by uuid NOT NULL DEFAULT auth.uid(),
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(branch_id,checkout_key),CHECK(checkout_key=((payload_text::jsonb)->>'key'))
);
ALTER TABLE public.branch_hub_replicated_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_sales_read ON public.branch_hub_replicated_sales FOR SELECT TO authenticated
 USING ((public.can_permission('branches.manage') OR public.is_platform_admin()) AND
 EXISTS(SELECT 1 FROM public.branches b WHERE b.id=branch_id AND b.organization_id=branch_hub_replicated_sales.organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))));
CREATE POLICY hub_sales_insert ON public.branch_hub_replicated_sales FOR INSERT TO authenticated
 WITH CHECK (received_by=auth.uid() AND (public.can_permission('branches.manage') OR public.is_platform_admin()) AND
 EXISTS(SELECT 1 FROM public.branches b WHERE b.id=branch_id AND b.organization_id=branch_hub_replicated_sales.organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))));
REVOKE ALL ON public.branch_hub_replicated_sales FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.branch_hub_replicated_sales TO authenticated;

CREATE FUNCTION public.receive_branch_hub_sale_v1(p_organization_id uuid,p_branch_id uuid,p_installation_id uuid,p_event_id uuid,p_payload_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE payload jsonb; existing public.branch_hub_replicated_sales%ROWTYPE; fingerprint text; revenue numeric; bad boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.can_permission('branches.manage') OR public.is_platform_admin()) OR NOT EXISTS
 (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.organization_id=p_organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))) THEN
  RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE='42501';
 END IF;
 IF octet_length(p_payload_text)>65536 OR p_installation_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'INVALID_HUB_EVENT'; END IF;
 payload:=p_payload_text::jsonb;
 IF NOT public.validate_branch_hub_payload_v1(p_event_id,p_branch_id,p_payload_text) THEN RAISE EXCEPTION 'INVALID_HUB_EVENT'; END IF;
 fingerprint:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');
 INSERT INTO public.branch_hub_replicated_sales(event_id,organization_id,branch_id,installation_id,checkout_key,payload_text,payload_sha256)
 VALUES(p_event_id,p_organization_id,p_branch_id,p_installation_id,payload->>'key',p_payload_text,fingerprint) ON CONFLICT DO NOTHING;
 SELECT * INTO existing FROM public.branch_hub_replicated_sales WHERE branch_id=p_branch_id AND checkout_key=payload->>'key';
 IF existing.event_id IS DISTINCT FROM p_event_id OR existing.payload_sha256 IS DISTINCT FROM fingerprint OR existing.organization_id IS DISTINCT FROM p_organization_id
 OR existing.installation_id IS DISTINCT FROM p_installation_id THEN RAISE EXCEPTION 'HUB_IDEMPOTENCY_CONFLICT'; END IF;
 RETURN jsonb_build_object('stage','received','eventId',p_event_id,'organizationId',p_organization_id,'branchId',p_branch_id,'payloadHash',fingerprint,'projectRef','hvqlkapynjfjikqithvd');
END $$;
REVOKE ALL ON FUNCTION public.receive_branch_hub_sale_v1(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_branch_hub_sale_v1(uuid,uuid,uuid,uuid,text) TO authenticated;

CREATE TABLE public.branch_hub_price_commands (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 sku text NOT NULL CHECK(sku ~ '^[a-zA-Z0-9_.-]{1,80}$'),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 sale_price_minor bigint NOT NULL CHECK(sale_price_minor BETWEEN 0 AND 9007199254740991),
 unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor BETWEEN 0 AND 9007199254740991),
 published_by uuid NOT NULL DEFAULT auth.uid(),published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(branch_id,sku,revision)
);
ALTER TABLE public.branch_hub_price_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_price_read ON public.branch_hub_price_commands FOR SELECT TO authenticated
 USING ((public.can_permission('branches.manage') OR public.is_platform_admin()) AND EXISTS(SELECT 1 FROM public.branches b WHERE b.id=branch_id AND b.organization_id=branch_hub_price_commands.organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))));
CREATE POLICY hub_price_publish ON public.branch_hub_price_commands FOR INSERT TO authenticated
 WITH CHECK (published_by=auth.uid() AND (public.can_permission('branches.manage') OR public.is_platform_admin()) AND EXISTS(SELECT 1 FROM public.branches b WHERE b.id=branch_id AND b.organization_id=branch_hub_price_commands.organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))));
REVOKE ALL ON public.branch_hub_price_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.branch_hub_price_commands TO authenticated;

CREATE TABLE public.branch_hub_command_receipts (
 installation_id uuid NOT NULL,command_id uuid NOT NULL REFERENCES public.branch_hub_price_commands(id) ON DELETE CASCADE,
 received_by uuid NOT NULL DEFAULT auth.uid(),received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(installation_id,command_id)
);
ALTER TABLE public.branch_hub_command_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_command_ack_read ON public.branch_hub_command_receipts FOR SELECT TO authenticated
 USING (received_by=auth.uid() AND EXISTS(SELECT 1 FROM public.branch_hub_price_commands c WHERE c.id=command_id));
CREATE POLICY hub_command_ack_insert ON public.branch_hub_command_receipts FOR INSERT TO authenticated
 WITH CHECK (received_by=auth.uid() AND EXISTS(SELECT 1 FROM public.branch_hub_price_commands c WHERE c.id=command_id));
REVOKE ALL ON public.branch_hub_command_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.branch_hub_command_receipts TO authenticated;

CREATE FUNCTION public.pull_branch_hub_prices_v1(p_organization_id uuid,p_branch_id uuid,p_installation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(commands)),'[]'::jsonb) FROM (
 SELECT c.id,c.organization_id,c.branch_id,c.sku,c.revision,c.sale_price_minor,c.unit_cost_minor
 FROM public.branch_hub_price_commands c WHERE c.organization_id=p_organization_id AND c.branch_id=p_branch_id
 AND NOT EXISTS(SELECT 1 FROM public.branch_hub_command_receipts r WHERE r.command_id=c.id AND r.installation_id=p_installation_id)
 ORDER BY c.published_at,c.id LIMIT 100) commands
$$;
REVOKE ALL ON FUNCTION public.pull_branch_hub_prices_v1(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pull_branch_hub_prices_v1(uuid,uuid,uuid) TO authenticated;
