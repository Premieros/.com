-- Restore an additive schema contract that existed in Premier production but
-- was absent from the canonical Git migration set. Never copy live rows,
-- replace the table, or change movement/ledger writers.
--
-- Production reference: private.raw_warehouse_movements_v2 in Supabase
-- hvqlkapynjfjikqithvd, inspected read-only on 2026-11-07.
CREATE TABLE IF NOT EXISTS private.raw_warehouse_movements_v2 (
  operation_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  raw_material_id uuid NOT NULL,
  quantity_delta numeric(18,4) NOT NULL,
  before_qty numeric(18,4) NOT NULL,
  after_qty numeric(18,4) NOT NULL,
  unit_cost numeric(18,6) NOT NULL,
  total_cost numeric(24,6) NOT NULL,
  price_event_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ledger_id bigint,
  entry_type text,
  source_reference_type text,
  source_reference_id uuid,
  CONSTRAINT raw_warehouse_movements_v2_pkey PRIMARY KEY (operation_id),
  CONSTRAINT raw_warehouse_movements_v2_ledger_id_key UNIQUE (ledger_id),
  CONSTRAINT raw_warehouse_movements_v2_ledger_id_fkey
    FOREIGN KEY (ledger_id) REFERENCES public.inventory_ledger(id),
  CONSTRAINT raw_warehouse_movements_v2_check
    CHECK (after_qty = before_qty + quantity_delta),
  CONSTRAINT raw_warehouse_movements_v2_quantity_delta_check
    CHECK (quantity_delta <> 0),
  CONSTRAINT raw_warehouse_movements_v2_unit_cost_check
    CHECK (unit_cost >= 0)
);

-- Fail closed if a same-named object has a different shape; CREATE TABLE IF NOT
-- EXISTS alone is insufficient to guarantee compatibility.
DO $schema_contract$
DECLARE
  invalid_columns integer;
  matching_constraints integer;
BEGIN
  WITH expected(attname, sql_type, required) AS (
    VALUES
      ('operation_id','uuid',true),
      ('branch_id','uuid',true),
      ('warehouse_id','uuid',true),
      ('raw_material_id','uuid',true),
      ('quantity_delta','numeric(18,4)',true),
      ('before_qty','numeric(18,4)',true),
      ('after_qty','numeric(18,4)',true),
      ('unit_cost','numeric(18,6)',true),
      ('total_cost','numeric(24,6)',true),
      ('price_event_id','uuid',false),
      ('created_at','timestamp with time zone',true),
      ('ledger_id','bigint',false),
      ('entry_type','text',false),
      ('source_reference_type','text',false),
      ('source_reference_id','uuid',false)
  )
  SELECT count(*) INTO invalid_columns FROM expected e
  LEFT JOIN pg_attribute a
    ON a.attrelid='private.raw_warehouse_movements_v2'::regclass
   AND a.attname=e.attname AND a.attnum>0 AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod) <> e.sql_type
    OR a.attnotnull IS DISTINCT FROM e.required;

  SELECT count(*) INTO matching_constraints
  FROM pg_constraint c
  WHERE c.conrelid='private.raw_warehouse_movements_v2'::regclass
    AND c.conname IN (
      'raw_warehouse_movements_v2_pkey',
      'raw_warehouse_movements_v2_ledger_id_key',
      'raw_warehouse_movements_v2_ledger_id_fkey',
      'raw_warehouse_movements_v2_check',
      'raw_warehouse_movements_v2_quantity_delta_check',
      'raw_warehouse_movements_v2_unit_cost_check'
    );

  IF invalid_columns <> 0 OR matching_constraints <> 6 THEN
    RAISE EXCEPTION 'PREMIER_RAW_MOVEMENTS_SCHEMA_DRIFT: columns=%, constraints=%',
      invalid_columns, matching_constraints;
  END IF;
END;
$schema_contract$;

ALTER TABLE private.raw_warehouse_movements_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.raw_warehouse_movements_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.raw_warehouse_movements_v2 TO service_role;
-- No anonymous/authenticated policies; private schema remains outside Data API.
