-- Saudi ZATCA data model, isolated from existing sales/accounting writes.
-- OWNER APPROVAL: 2026-11-17 explicit approval for configuration, EGS,
-- electronic documents and submission-state tables.
-- No credentials, CSID private keys, tax submissions or historic data changes.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE SCHEMA IF NOT EXISTS private;

-- Every new table lives in non-exposed private schema. Access is deny-by-default.
CREATE TABLE private.zatca_branch_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  country_code text NOT NULL DEFAULT 'SA' CHECK (country_code = 'SA'),
  vat_registration_number text CHECK (
    vat_registration_number IS NULL OR vat_registration_number ~ '^[0-9]{15}$'
  ),
  enabled boolean NOT NULL DEFAULT false,
  onboarding_complete boolean NOT NULL DEFAULT false,
  compliance_tested boolean NOT NULL DEFAULT false,
  production_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zatca_settings_scope_unique UNIQUE (organization_id, branch_id, environment),
  CONSTRAINT zatca_settings_id_scope_unique UNIQUE (id, organization_id, branch_id, environment),
  CONSTRAINT zatca_no_unapproved_production CHECK (
    environment <> 'production' OR enabled = false OR production_approved
  )
);

-- Validate branch ownership without adding constraints to existing Premier tables.
-- Never accept a browser-controlled organization_id as evidence of ownership.
CREATE FUNCTION private.zatca_check_branch_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = NEW.branch_id
      AND b.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'ZATCA_BRANCH_ORGANIZATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.zatca_check_branch_ownership() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zatca_settings_branch_scope_guard
  BEFORE INSERT OR UPDATE OF organization_id, branch_id
  ON private.zatca_branch_settings
  FOR EACH ROW EXECUTE FUNCTION private.zatca_check_branch_ownership();

CREATE TABLE private.zatca_egs_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settings_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  device_code text NOT NULL CHECK (length(btrim(device_code)) BETWEEN 1 AND 128),
  -- Opaque vault references ONLY: never actual secrets, OTPs, CSIDs or keys.
  credential_vault_reference text,
  status text NOT NULL DEFAULT 'unconfigured'
    CHECK (status IN ('unconfigured', 'onboarding', 'ready', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zatca_egs_settings_scope_fk FOREIGN KEY
    (settings_id, organization_id, branch_id, environment)
    REFERENCES private.zatca_branch_settings
    (id, organization_id, branch_id, environment) ON DELETE RESTRICT,
  CONSTRAINT zatca_egs_id_scope_unique
    UNIQUE (id, organization_id, branch_id, environment),
  CONSTRAINT zatca_egs_device_unique
    UNIQUE (organization_id, branch_id, environment, device_code)
);

CREATE TABLE private.zatca_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  egs_device_id uuid NOT NULL,
  source_sale_id uuid,
  invoice_uuid uuid NOT NULL,
  invoice_number text NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 128),
  kind text NOT NULL CHECK (kind IN ('standard', 'simplified', 'credit_note', 'debit_note')),
  issued_at timestamptz,
  signed_xml_vault_reference text,
  invoice_hash text,
  previous_invoice_hash text,
  invoice_counter bigint CHECK (invoice_counter > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'prepared', 'signed', 'pending_clearance',
      'cleared', 'issued_pending_reporting', 'reported', 'rejected',
      'needs_reconciliation', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zatca_document_egs_scope_fk FOREIGN KEY
    (egs_device_id, organization_id, branch_id, environment)
    REFERENCES private.zatca_egs_devices (id, organization_id, branch_id, environment)
    ON DELETE RESTRICT,
  CONSTRAINT zatca_document_source_sale_fk FOREIGN KEY (source_sale_id, branch_id)
    REFERENCES public.sales (id, branch_id) ON DELETE RESTRICT,
  CONSTRAINT zatca_document_id_scope_unique UNIQUE
    (id, organization_id, branch_id, environment, egs_device_id),
  CONSTRAINT zatca_invoice_uuid_egs_unique UNIQUE (egs_device_id, invoice_uuid),
  CONSTRAINT zatca_invoice_number_egs_unique UNIQUE (egs_device_id, invoice_number),
  CONSTRAINT zatca_invoice_counter_egs_unique UNIQUE (egs_device_id, invoice_counter)
);

CREATE TABLE private.zatca_submission_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  egs_device_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('clearance', 'reporting')),
  state text NOT NULL DEFAULT 'queued' CHECK (
    state IN ('queued', 'leased', 'accepted', 'rejected',
      'needs_reconciliation', 'blocked')
  ),
  -- CAS fencing token to be checked by a future private claiming function.
  lease_token uuid,
  lease_acquired_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  response_http_status integer CHECK
    (response_http_status IS NULL OR response_http_status BETWEEN 100 AND 599),
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zatca_outbox_document_scope_fk FOREIGN KEY
    (document_id, organization_id, branch_id, environment, egs_device_id)
    REFERENCES private.zatca_documents
    (id, organization_id, branch_id, environment, egs_device_id)
    ON DELETE RESTRICT,
  CONSTRAINT zatca_outbox_one_action_per_document UNIQUE (document_id, channel),
  CONSTRAINT zatca_outbox_lease_fields_check CHECK (
    (state = 'leased' AND lease_token IS NOT NULL AND lease_acquired_at IS NOT NULL)
    OR state <> 'leased'
  )
);

-- Document identity and signed artefacts can never be overwritten post-issuance.
CREATE FUNCTION private.zatca_guard_document_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status NOT IN ('draft', 'prepared') AND (
     NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.branch_id IS DISTINCT FROM OLD.branch_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.egs_device_id IS DISTINCT FROM OLD.egs_device_id OR
     NEW.source_sale_id IS DISTINCT FROM OLD.source_sale_id OR
     NEW.invoice_uuid IS DISTINCT FROM OLD.invoice_uuid OR
     NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR
     NEW.kind IS DISTINCT FROM OLD.kind OR
     NEW.issued_at IS DISTINCT FROM OLD.issued_at OR
     NEW.signed_xml_vault_reference IS DISTINCT FROM OLD.signed_xml_vault_reference OR
     NEW.invoice_hash IS DISTINCT FROM OLD.invoice_hash OR
     NEW.previous_invoice_hash IS DISTINCT FROM OLD.previous_invoice_hash OR
     NEW.invoice_counter IS DISTINCT FROM OLD.invoice_counter
  ) THEN
    RAISE EXCEPTION 'ZATCA_ISSUED_DOCUMENT_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.zatca_guard_document_identity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zatca_document_immutable_after_signing
  BEFORE UPDATE ON private.zatca_documents
  FOR EACH ROW EXECUTE FUNCTION private.zatca_guard_document_identity();

CREATE INDEX zatca_outbox_work_scan_idx
  ON private.zatca_submission_outbox (state, created_at, id);
CREATE INDEX zatca_document_organization_branch_idx
  ON private.zatca_documents (organization_id, branch_id, created_at);

-- No browser role is granted any direct access. No permissive RLS policies.
ALTER TABLE private.zatca_branch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.zatca_egs_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.zatca_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.zatca_submission_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.zatca_branch_settings,
  private.zatca_egs_devices, private.zatca_documents,
  private.zatca_submission_outbox FROM PUBLIC, anon, authenticated, service_role;
-- No grants to service_role yet: future RPCs must perform authenticated,
-- tenant-scoped operations with explicit reviewed permissions.
