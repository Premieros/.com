-- Premier branch integrity batch 2, 2026-11-15.
-- Preflight: no mismatches in all covered paths; preserve original ON DELETE actions.
-- Idempotent to reconcile Supabase MCP migration history and repository schema_migrations.
-- Does not change any business data. No NOT NULL enforcement on legacy optional columns.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raw_materials'::regclass AND conname='premier_raw_materials_id_branch_uq') THEN
    ALTER TABLE public.raw_materials ADD CONSTRAINT premier_raw_materials_id_branch_uq UNIQUE (id, branch_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raw_material_batches'::regclass AND conname='premier_raw_batches_material_branch_fk') THEN
    ALTER TABLE public.raw_material_batches ADD CONSTRAINT premier_raw_batches_material_branch_fk FOREIGN KEY (raw_material_id, branch_id) REFERENCES public.raw_materials(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raw_material_batches'::regclass AND conname='premier_raw_batches_warehouse_branch_fk') THEN
    ALTER TABLE public.raw_material_batches ADD CONSTRAINT premier_raw_batches_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raw_material_inventory'::regclass AND conname='premier_raw_inventory_material_branch_fk') THEN
    ALTER TABLE public.raw_material_inventory ADD CONSTRAINT premier_raw_inventory_material_branch_fk FOREIGN KEY (raw_material_id, branch_id) REFERENCES public.raw_materials(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_ledger'::regclass AND conname='premier_inventory_ledger_product_branch_fk') THEN
    ALTER TABLE public.inventory_ledger ADD CONSTRAINT premier_inventory_ledger_product_branch_fk FOREIGN KEY (product_id, branch_id) REFERENCES public.products(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_ledger'::regclass AND conname='premier_inventory_ledger_material_branch_fk') THEN
    ALTER TABLE public.inventory_ledger ADD CONSTRAINT premier_inventory_ledger_material_branch_fk FOREIGN KEY (raw_material_id, branch_id) REFERENCES public.raw_materials(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_ledger'::regclass AND conname='premier_inventory_ledger_warehouse_branch_fk') THEN
    ALTER TABLE public.inventory_ledger ADD CONSTRAINT premier_inventory_ledger_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id)  NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_movements'::regclass AND conname='premier_inventory_movements_product_branch_fk') THEN
    ALTER TABLE public.inventory_movements ADD CONSTRAINT premier_inventory_movements_product_branch_fk FOREIGN KEY (product_id, branch_id) REFERENCES public.products(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_movements'::regclass AND conname='premier_inventory_movements_warehouse_branch_fk') THEN
    ALTER TABLE public.inventory_movements ADD CONSTRAINT premier_inventory_movements_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raw_material_movements'::regclass AND conname='premier_raw_movements_material_branch_fk') THEN
    ALTER TABLE public.raw_material_movements ADD CONSTRAINT premier_raw_movements_material_branch_fk FOREIGN KEY (material_id, branch_id) REFERENCES public.raw_materials(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raw_material_movements'::regclass AND conname='premier_raw_movements_warehouse_branch_fk') THEN
    ALTER TABLE public.raw_material_movements ADD CONSTRAINT premier_raw_movements_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_unit_entries'::regclass AND conname='premier_unit_entries_warehouse_branch_fk') THEN
    ALTER TABLE public.inventory_unit_entries ADD CONSTRAINT premier_unit_entries_warehouse_branch_fk FOREIGN KEY (warehouse_id, branch_id) REFERENCES public.warehouses(id, branch_id)  NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.raw_material_batches VALIDATE CONSTRAINT premier_raw_batches_material_branch_fk;
ALTER TABLE public.raw_material_batches VALIDATE CONSTRAINT premier_raw_batches_warehouse_branch_fk;
ALTER TABLE public.raw_material_inventory VALIDATE CONSTRAINT premier_raw_inventory_material_branch_fk;
ALTER TABLE public.inventory_ledger VALIDATE CONSTRAINT premier_inventory_ledger_product_branch_fk;
ALTER TABLE public.inventory_ledger VALIDATE CONSTRAINT premier_inventory_ledger_material_branch_fk;
ALTER TABLE public.inventory_ledger VALIDATE CONSTRAINT premier_inventory_ledger_warehouse_branch_fk;
ALTER TABLE public.inventory_movements VALIDATE CONSTRAINT premier_inventory_movements_product_branch_fk;
ALTER TABLE public.inventory_movements VALIDATE CONSTRAINT premier_inventory_movements_warehouse_branch_fk;
ALTER TABLE public.raw_material_movements VALIDATE CONSTRAINT premier_raw_movements_material_branch_fk;
ALTER TABLE public.raw_material_movements VALIDATE CONSTRAINT premier_raw_movements_warehouse_branch_fk;
ALTER TABLE public.inventory_unit_entries VALIDATE CONSTRAINT premier_unit_entries_warehouse_branch_fk;
