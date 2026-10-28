-- Narrow bridge to the EXISTING canonical POS transaction. Does not replace any business function.
-- v1 accepts ready products, exactly one warehouse/base unit, cash, no tax/discount/modifiers.
CREATE TABLE public.branch_hub_posted_sales (
 event_id uuid PRIMARY KEY REFERENCES public.branch_hub_replicated_sales(event_id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
 installation_id uuid NOT NULL,payload_sha256 text NOT NULL,
 sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
 journal_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE CASCADE,
 total_minor bigint NOT NULL CHECK(total_minor>0),cost_minor bigint NOT NULL CHECK(cost_minor>=0),
 posted_by uuid NOT NULL DEFAULT auth.uid(),posted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branch_hub_posted_sales_org_idx ON public.branch_hub_posted_sales(organization_id);
CREATE INDEX branch_hub_posted_sales_branch_idx ON public.branch_hub_posted_sales(branch_id);
ALTER TABLE public.branch_hub_posted_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_post_read ON public.branch_hub_posted_sales FOR SELECT TO authenticated
 USING ((public.can_permission('branches.manage') OR public.is_platform_admin()) AND EXISTS
 (SELECT 1 FROM public.branches b WHERE b.id=branch_id AND b.organization_id=branch_hub_posted_sales.organization_id AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))));
CREATE POLICY hub_post_insert ON public.branch_hub_posted_sales FOR INSERT TO authenticated
 WITH CHECK (posted_by=(SELECT auth.uid()) AND public.can_permission('pos.payment.take') AND
 (public.can_permission('branches.manage') OR public.is_platform_admin()) AND EXISTS
 (SELECT 1 FROM public.branches b WHERE b.id=branch_id AND b.organization_id=branch_hub_posted_sales.organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))));
REVOKE ALL ON public.branch_hub_posted_sales FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.branch_hub_posted_sales TO authenticated;

-- A direct table INSERT cannot fabricate a posting receipt: prove the official sale, stock effects and journal.
CREATE FUNCTION public.validate_branch_hub_post_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE source public.branch_hub_replicated_sales%ROWTYPE; payload jsonb; sale public.sales%ROWTYPE;
 expected_cost numeric; dr numeric; cr numeric; line_count integer; actual_journal uuid; journal_count integer;
BEGIN
 SELECT * INTO source FROM public.branch_hub_replicated_sales WHERE event_id=NEW.event_id
 AND organization_id=NEW.organization_id AND branch_id=NEW.branch_id AND installation_id=NEW.installation_id AND payload_sha256=NEW.payload_sha256;
 IF NOT FOUND THEN RAISE EXCEPTION 'HUB_POST_SOURCE_MISMATCH'; END IF;
 payload:=source.payload_text::jsonb;
 SELECT sum((l->>'costMinor')::numeric) INTO expected_cost FROM jsonb_array_elements(payload->'lines')l;
 IF NEW.total_minor!=(payload->>'totalMinor')::numeric OR NEW.cost_minor!=expected_cost THEN RAISE EXCEPTION 'HUB_POST_AMOUNT_MISMATCH'; END IF;
 SELECT * INTO sale FROM public.sales WHERE id=NEW.sale_id AND branch_id=NEW.branch_id;
 IF NOT FOUND OR sale.invoice_number!='BH-'||replace(NEW.event_id::text,'-','') OR sale.status!='completed'
 OR sale.cashier_id IS DISTINCT FROM NEW.posted_by OR sale.total*100!=NEW.total_minor OR sale.paid_amount*100!=NEW.total_minor
 OR coalesce(sale.tax_amount,0)!=0 OR coalesce(sale.discount_amount,0)!=0 OR coalesce(sale.bonus_amount,0)!=0 OR sale.payment_method!='cash'
 THEN RAISE EXCEPTION 'HUB_POST_SALE_MISMATCH'; END IF;
 IF (SELECT count(*) FROM public.sale_items WHERE sale_id=NEW.sale_id)!=jsonb_array_length(payload->'lines') OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(payload->'lines')l LEFT JOIN public.sale_items si
  ON si.sale_id=NEW.sale_id AND si.product_id=(l->'canonical'->>'productId')::uuid
  WHERE si.id IS NULL OR si.unit_name IS DISTINCT FROM l->'canonical'->>'unitName' OR si.quantity!=(l->>'quantity')::numeric
   OR si.unit_price*100!=(l->>'priceMinor')::numeric OR coalesce(si.discount_amount,0)!=0 OR coalesce(si.bonus_quantity,0)!=0
   OR NOT EXISTS(SELECT 1 FROM public.sale_item_inventory_effects e WHERE e.sale_item_id=si.id AND e.sale_id=NEW.sale_id
    AND e.branch_id=NEW.branch_id AND e.warehouse_id=(l->'canonical'->>'warehouseId')::uuid AND e.target_type='product'
    AND e.target_id=si.product_id AND e.quantity=si.quantity)
 ) OR EXISTS(SELECT 1 FROM public.sale_item_inventory_effects e WHERE e.sale_id=NEW.sale_id AND
  (e.branch_id!=NEW.branch_id OR e.target_type!='product' OR e.quantity<=0)) THEN RAISE EXCEPTION 'HUB_POST_STOCK_OR_LINES_MISMATCH'; END IF;
 SELECT count(*),min(id::text)::uuid INTO journal_count,actual_journal FROM public.journal_entries
 WHERE branch_id=NEW.branch_id AND reference_type='sale' AND reference_id=NEW.sale_id AND posting_status='POSTED';
 IF journal_count!=1 OR actual_journal IS DISTINCT FROM NEW.journal_id THEN RAISE EXCEPTION 'HUB_POST_JOURNAL_MISSING'; END IF;
 SELECT coalesce(sum(debit),0),coalesce(sum(credit),0),count(*) INTO dr,cr,line_count
 FROM public.journal_entry_lines WHERE journal_entry_id=NEW.journal_id;
 IF dr!=cr OR dr*100!=NEW.total_minor+NEW.cost_minor OR line_count!=CASE WHEN NEW.cost_minor>0 THEN 4 ELSE 2 END
 OR (SELECT coalesce(sum(debit),0)*100 FROM public.journal_entry_lines WHERE journal_entry_id=NEW.journal_id AND account_id=public.resolve_account_key(NEW.branch_id,'cash',NULL))!=NEW.total_minor
 OR (SELECT coalesce(sum(credit),0)*100 FROM public.journal_entry_lines WHERE journal_entry_id=NEW.journal_id AND account_id=public.resolve_account_key(NEW.branch_id,'revenue',NULL))!=NEW.total_minor
 OR (SELECT coalesce(sum(debit),0)*100 FROM public.journal_entry_lines WHERE journal_entry_id=NEW.journal_id AND account_id=public.resolve_account_key(NEW.branch_id,'cogs',NULL))!=NEW.cost_minor
 OR (SELECT coalesce(sum(credit),0)*100 FROM public.journal_entry_lines WHERE journal_entry_id=NEW.journal_id AND account_id=public.resolve_account_key(NEW.branch_id,'inventory_fg',NULL))!=NEW.cost_minor
 THEN RAISE EXCEPTION 'HUB_POST_JOURNAL_MISMATCH'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_branch_hub_post_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_branch_hub_post_v1() TO authenticated;
CREATE TRIGGER branch_hub_post_verify BEFORE INSERT ON public.branch_hub_posted_sales FOR EACH ROW EXECUTE FUNCTION public.validate_branch_hub_post_v1();

CREATE FUNCTION public.post_branch_hub_sale_v1(p_organization_id uuid,p_branch_id uuid,p_installation_id uuid,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE source public.branch_hub_replicated_sales%ROWTYPE; previous public.branch_hub_posted_sales%ROWTYPE;
 payload jsonb; line jsonb; product public.products%ROWTYPE; v_warehouse_id uuid; v_product_id uuid; row_warehouse uuid;
 items jsonb:='[]'::jsonb; result jsonb; v_sale_id uuid; v_journal_id uuid; v_cost_minor numeric; available numeric; failure text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('pos.payment.take') OR NOT (public.can_permission('branches.manage') OR public.is_platform_admin()) OR NOT EXISTS
 (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.organization_id=p_organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))) THEN
 RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('branch-hub-post:'||p_branch_id::text||':'||p_event_id::text,0));
 SELECT * INTO source FROM public.branch_hub_replicated_sales WHERE event_id=p_event_id AND organization_id=p_organization_id AND branch_id=p_branch_id AND installation_id=p_installation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'HUB_RECEIVED_EVENT_REQUIRED'; END IF;
 SELECT * INTO previous FROM public.branch_hub_posted_sales WHERE event_id=p_event_id;
 IF NOT FOUND THEN
  -- Exception subtransaction covers every canonical side effect, including functions returning success=false.
  BEGIN
   payload:=source.payload_text::jsonb;
   IF payload->>'paymentAccount'!='cash' THEN RAISE EXCEPTION 'HUB_BANK_METHOD_REQUIRED'; END IF;
   IF EXISTS(SELECT 1 FROM public._effective_branch_tax(p_branch_id)t WHERE t.tax_enabled AND t.tax_rate!=0) THEN RAISE EXCEPTION 'HUB_TAX_RULE_CONFLICT'; END IF;
   FOR line IN SELECT l FROM jsonb_array_elements(payload->'lines')l ORDER BY l->'canonical'->>'productId' LOOP
    IF jsonb_typeof(line->'canonical') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'HUB_MAPPING_REQUIRED'; END IF;
    v_product_id:=(line->'canonical'->>'productId')::uuid;row_warehouse:=(line->'canonical'->>'warehouseId')::uuid;
    IF v_product_id IS NULL OR row_warehouse IS NULL OR line->>'sku' IS DISTINCT FROM 'p_'||v_product_id::text||'_'||row_warehouse::text THEN RAISE EXCEPTION 'HUB_MAPPING_REQUIRED'; END IF;
    IF v_warehouse_id IS NOT NULL AND v_warehouse_id!=row_warehouse THEN RAISE EXCEPTION 'HUB_MULTIPLE_WAREHOUSES_UNSUPPORTED'; END IF;
    v_warehouse_id:=row_warehouse;
    IF NOT EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=v_warehouse_id AND w.branch_id=p_branch_id AND w.is_active) THEN RAISE EXCEPTION 'HUB_WAREHOUSE_SCOPE_CONFLICT'; END IF;
    SELECT * INTO product FROM public.products p WHERE p.id=v_product_id AND p.branch_id=p_branch_id AND p.is_active FOR SHARE;
    IF NOT FOUND OR product.product_type IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'HUB_READY_PRODUCT_REQUIRED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.product_units u WHERE u.product_id=product.id AND u.is_base AND u.conversion_factor=1 AND u.unit_name=line->'canonical'->>'unitName') THEN RAISE EXCEPTION 'HUB_BASE_UNIT_CONFLICT'; END IF;
    IF product.sale_price*100!=(line->>'priceMinor')::numeric THEN RAISE EXCEPTION 'HUB_PRICE_CHANGED'; END IF;
    IF coalesce(product.cost_price,0)*(line->>'quantity')::numeric*100!=(line->>'costMinor')::numeric THEN RAISE EXCEPTION 'HUB_COST_CHANGED'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('product:'||product.id::text||':'||v_warehouse_id::text,0));
    SELECT coalesce(sum(ib.quantity),0) INTO available FROM public.inventory_batches ib WHERE ib.product_id=product.id AND ib.branch_id=p_branch_id AND ib.warehouse_id=v_warehouse_id;
    IF available<(line->>'quantity')::numeric THEN RAISE EXCEPTION 'HUB_CLOUD_STOCK_SHORTAGE'; END IF;
    items:=items||jsonb_build_array(jsonb_build_object('product_id',product.id,'unit_name',line->'canonical'->>'unitName',
      'quantity',(line->>'quantity')::numeric,'unit_price',(line->>'priceMinor')::numeric/100,'discount_amount',0,'bonus_quantity',0,'modifier_option_ids','[]'::jsonb));
   END LOOP;
   result:=public.process_sale_idempotent('hub:'||p_event_id::text,'BH-'||replace(p_event_id::text,'-',''),p_branch_id,v_warehouse_id,
     NULL,auth.uid(),(payload->>'totalMinor')::numeric/100,0,'amount',0,0,(payload->>'totalMinor')::numeric/100,
     (payload->>'totalMinor')::numeric/100,'cash','completed',items,NULL,'takeaway',NULL,NULL,NULL);
   IF coalesce((result->>'success')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'HUB_CANONICAL_SALE_REJECTED'; END IF;
   v_sale_id:=(result->>'sale_id')::uuid;
   SELECT sum((l->>'costMinor')::numeric) INTO v_cost_minor FROM jsonb_array_elements(payload->'lines')l;
   IF coalesce((result->>'cogs')::numeric,-1)*100!=v_cost_minor THEN RAISE EXCEPTION 'HUB_CANONICAL_COST_CONFLICT'; END IF;
   SELECT j.id INTO v_journal_id FROM public.journal_entries j WHERE j.branch_id=p_branch_id AND j.reference_type='sale' AND j.reference_id=v_sale_id AND j.posting_status='POSTED';
   IF v_journal_id IS NULL THEN RAISE EXCEPTION 'HUB_POST_JOURNAL_MISSING'; END IF;
   INSERT INTO public.branch_hub_posted_sales(event_id,organization_id,branch_id,installation_id,payload_sha256,sale_id,journal_id,total_minor,cost_minor)
    VALUES(p_event_id,p_organization_id,p_branch_id,p_installation_id,source.payload_sha256,v_sale_id,v_journal_id,(payload->>'totalMinor')::bigint,v_cost_minor::bigint)
    RETURNING * INTO previous;
  EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
   RETURN jsonb_build_object('stage','conflict','reason',CASE WHEN failure LIKE 'HUB_%' THEN failure ELSE 'HUB_CANONICAL_TRANSACTION_FAILED' END,
    'eventId',p_event_id,'projectRef','hvqlkapynjfjikqithvd','organizationId',p_organization_id,'branchId',p_branch_id,'payloadHash',source.payload_sha256);
  END;
 END IF;
 RETURN jsonb_build_object('stage','posted','eventId',previous.event_id,'installationId',previous.installation_id,'projectRef','hvqlkapynjfjikqithvd',
 'organizationId',previous.organization_id,'branchId',previous.branch_id,'payloadHash',previous.payload_sha256,'canonicalSaleId',previous.sale_id,
 'canonicalJournalId',previous.journal_id,'totalMinor',previous.total_minor,'costMinor',previous.cost_minor);
END $$;
REVOKE ALL ON FUNCTION public.post_branch_hub_sale_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_branch_hub_sale_v1(uuid,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.get_branch_hub_catalog_v1(p_organization_id uuid,p_branch_id uuid,p_warehouse_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE product record; command public.branch_hub_price_commands%ROWTYPE; v_sku text; products jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb; v_revision bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.can_permission('branches.manage') OR public.is_platform_admin()) OR NOT EXISTS
 (SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.organization_id=p_organization_id AND b.is_active AND (public.is_platform_admin() OR public.user_may_access_branch(b.id))) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active) THEN RAISE EXCEPTION 'HUB_WAREHOUSE_SCOPE_CONFLICT'; END IF;
 IF (SELECT count(*) FROM public.products WHERE branch_id=p_branch_id AND is_active AND product_type='ready')>5000 THEN RAISE EXCEPTION 'HUB_CATALOG_PAGINATION_REQUIRED'; END IF;
 FOR product IN SELECT p.*,u.unit_name,stock.quantity FROM public.products p
 LEFT JOIN LATERAL(SELECT unit_name FROM public.product_units WHERE product_id=p.id AND is_base AND conversion_factor=1 ORDER BY id LIMIT 1)u ON true
 CROSS JOIN LATERAL(SELECT coalesce(sum(ib.quantity),0) quantity FROM public.inventory_batches ib WHERE ib.product_id=p.id AND ib.branch_id=p_branch_id AND ib.warehouse_id=p_warehouse_id)stock
 WHERE p.branch_id=p_branch_id AND p.is_active AND p.product_type='ready' ORDER BY p.id FOR SHARE OF p LOOP
  IF product.unit_name IS NULL OR product.quantity<0 OR trunc(product.quantity)!=product.quantity OR product.quantity>9007199254740991
   OR product.sale_price<=0 OR product.sale_price IS NULL OR round(product.sale_price,2)!=product.sale_price
   OR coalesce(product.cost_price,0)<0 OR round(coalesce(product.cost_price,0),2)!=coalesce(product.cost_price,0) THEN
   skipped:=skipped||jsonb_build_array(jsonb_build_object('productId',product.id,'name',product.name,'reason','BASE_UNIT_OR_PRECISION_UNSUPPORTED'));CONTINUE;
  END IF;
  v_sku:='p_'||product.id::text||'_'||p_warehouse_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended('branch-hub-price:'||p_branch_id::text||':'||v_sku,0));
  SELECT * INTO command FROM public.branch_hub_price_commands c WHERE c.branch_id=p_branch_id AND c.sku=v_sku ORDER BY c.revision DESC LIMIT 1;
  IF NOT FOUND OR command.sale_price_minor!=product.sale_price*100 OR command.unit_cost_minor!=coalesce(product.cost_price,0)*100 THEN
   v_revision:=coalesce(command.revision,0)+1;
   INSERT INTO public.branch_hub_price_commands(id,organization_id,branch_id,sku,revision,sale_price_minor,unit_cost_minor)
   VALUES(gen_random_uuid(),p_organization_id,p_branch_id,v_sku,v_revision,(product.sale_price*100)::bigint,(coalesce(product.cost_price,0)*100)::bigint) RETURNING * INTO command;
  END IF;
  products:=products||jsonb_build_array(jsonb_build_object('sku',v_sku,'productId',product.id,'name',product.name,'unitName',product.unit_name,'quantity',product.quantity,
    'priceCommand',jsonb_build_object('id',command.id,'organization_id',command.organization_id,'branch_id',command.branch_id,'sku',command.sku,'revision',command.revision,'sale_price_minor',command.sale_price_minor,'unit_cost_minor',command.unit_cost_minor)));
 END LOOP;
 RETURN jsonb_build_object('organizationId',p_organization_id,'branchId',p_branch_id,'warehouseId',p_warehouse_id,'scope','ready-base-unit-cash-v1','products',products,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION public.get_branch_hub_catalog_v1(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_branch_hub_catalog_v1(uuid,uuid,uuid) TO authenticated;
