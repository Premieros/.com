-- ZATCA private, operator-only claim and fenced completion functions.
-- These functions remain INVOKER-SECURITY, non-exposed and grant-less.
-- There is NO scheduling, provider access, signing, credential storage,
-- public RPC, automatic replay or production transmission.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE FUNCTION private.zatca_claim_queued_v1(p_event_id uuid)
RETURNS TABLE (
  event_id uuid,
  fence_token uuid,
  document_id uuid,
  organization_id uuid,
  branch_id uuid,
  environment text,
  egs_device_id uuid,
  channel text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $zatca$
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'ZATCA_OUTBOX_EVENT_REQUIRED' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  WITH target AS (
    SELECT o.id
      FROM private.zatca_submission_outbox AS o
      JOIN private.zatca_documents AS d
        ON d.id = o.document_id
       AND d.organization_id = o.organization_id
       AND d.branch_id = o.branch_id
       AND d.environment = o.environment
       AND d.egs_device_id = o.egs_device_id
      JOIN private.zatca_egs_devices AS e
        ON e.id = d.egs_device_id
       AND e.organization_id = d.organization_id
       AND e.branch_id = d.branch_id
       AND e.environment = d.environment
      JOIN private.zatca_branch_settings AS s
        ON s.id = e.settings_id
       AND s.organization_id = d.organization_id
       AND s.branch_id = d.branch_id
       AND s.environment = d.environment
     WHERE o.id = p_event_id
       AND o.state = 'queued'
       AND o.attempt_count = 0
       AND o.environment = 'sandbox'
       AND s.enabled
       AND s.onboarding_complete
       AND s.compliance_tested
       AND e.status = 'ready'
       AND e.credential_vault_reference IS NOT NULL
       AND length(btrim(e.credential_vault_reference)) > 0
       AND d.signed_xml_vault_reference IS NOT NULL
       AND length(btrim(d.signed_xml_vault_reference)) > 0
       AND d.invoice_hash IS NOT NULL
       AND length(btrim(d.invoice_hash)) > 0
       AND d.invoice_counter > 0
       AND d.issued_at IS NOT NULL
       AND (
         (o.channel = 'clearance' AND d.kind = 'standard' AND d.status = 'signed')
         OR
         (o.channel = 'reporting' AND d.kind = 'simplified'
          AND d.status = 'issued_pending_reporting')
       )
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE private.zatca_submission_outbox AS o
     SET state = 'leased',
         lease_token = gen_random_uuid(),
         lease_acquired_at = clock_timestamp(),
         attempt_count = attempt_count + 1,
         updated_at = clock_timestamp()
    FROM target
   WHERE o.id = target.id
   RETURNING o.id, o.lease_token, o.document_id, o.organization_id,
     o.branch_id, o.environment, o.egs_device_id, o.channel;
END;
$zatca$;

CREATE FUNCTION private.zatca_complete_claim_v1(
  p_event_id uuid,
  p_fence_token uuid,
  p_state text,
  p_http_status integer DEFAULT NULL,
  p_reason_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $zatca$
DECLARE
  v_row private.zatca_submission_outbox%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR p_fence_token IS NULL THEN
    RAISE EXCEPTION 'ZATCA_OUTBOX_MISSING_FENCE' USING ERRCODE = '23514';
  END IF;
  IF p_state NOT IN ('accepted', 'rejected', 'needs_reconciliation', 'blocked')
    OR p_state IS NULL THEN
    RAISE EXCEPTION 'ZATCA_OUTBOX_INVALID_COMPLETION' USING ERRCODE = '23514';
  END IF;
  IF p_http_status IS NOT NULL AND
    (p_http_status < 100 OR p_http_status > 599) THEN
    RAISE EXCEPTION 'ZATCA_OUTBOX_INVALID_HTTP_CODE' USING ERRCODE = '23514';
  END IF;
  IF p_reason_code IS NOT NULL AND (
    length(p_reason_code) > 128 OR p_reason_code !~ '^[a-z0-9_]+$'
  ) THEN
    RAISE EXCEPTION 'ZATCA_OUTBOX_INVALID_REASON' USING ERRCODE = '23514';
  END IF;

  UPDATE private.zatca_submission_outbox
     SET state = p_state,
         response_http_status = p_http_status,
         reason_code = p_reason_code,
         updated_at = clock_timestamp()
   WHERE id = p_event_id
     AND lease_token = p_fence_token
     AND state = 'leased'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ZATCA_OUTBOX_FENCE_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF p_state IN ('accepted', 'rejected', 'needs_reconciliation') THEN
    UPDATE private.zatca_documents
       SET status = CASE
         WHEN p_state = 'accepted' AND v_row.channel = 'clearance' THEN 'cleared'
         WHEN p_state = 'accepted' AND v_row.channel = 'reporting' THEN 'reported'
         WHEN p_state = 'rejected' THEN 'rejected'
         ELSE 'needs_reconciliation'
       END,
       updated_at = clock_timestamp()
     WHERE id = v_row.document_id
       AND organization_id = v_row.organization_id
       AND branch_id = v_row.branch_id
       AND environment = v_row.environment
       AND egs_device_id = v_row.egs_device_id
       AND (
         (v_row.channel = 'clearance' AND status = 'signed') OR
         (v_row.channel = 'reporting' AND status = 'issued_pending_reporting')
       );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ZATCA_DOCUMENT_STATUS_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN true;
END;
$zatca$;

REVOKE ALL ON FUNCTION private.zatca_claim_queued_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.zatca_complete_claim_v1(uuid, uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
