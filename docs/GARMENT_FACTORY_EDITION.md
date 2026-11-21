# PremierOS Garments — Factory Edition (initial implementation)

> Working branch: `feature/garment-factory-profile`. This is an **initial industry profile**, not a completed standalone garment ERP. Do not merge into production or provision against the live database until reviewed.

## What is implemented

The existing multi-industry business-profile architecture now includes an Arabic/English **Garment Manufacturing** preset:

- Factory-oriented terminology, sidebar navigation, dashboard actions, and existing procurement, inventory, costing, catalog and finance modules.
- Product business attributes: style code, garment category, season, fabric type, size and color.
- Generic business records for samples, production plans and quality reviews.
- The existing restaurant-only kitchen/table workflows are not advertised to garment users.
- Unit tests check business-profile resolution and that core garments routes remain available.

The current hosted Supabase database accepts only a fixed `organizations.business_type` allow-list. The wizard therefore persists garments as `business_type = 'custom'` with `business_profile.preset_key = 'garment_manufacturing'`. This is **deliberate compatibility**, not an accidental replacement for a real factory data model. `resolveBusinessRuntime` uses `preset_key` to load the garment profile.

## Reusable existing functionality

| Existing area | Starting point | Boundary |
| --- | --- | --- |
| Products/catalog | Style setup and business attributes | Size/color values are per product, **not** yet a normalized variant matrix |
| Raw materials | Fabrics, trims, accessories and UOM | Roll/lot/shade tracking needs extensions |
| Recipes/BOM & costing | Existing raw-material components | Garment consumption per size and marker yield needs a separate model |
| Purchases/warehouses | Material receipt, movement, stock counts | Production WIP warehouse stages are not represented |
| Sales/customers/accounting | Wholesale billing and finance | No garment order-to-cut-bundle traceability yet |
| Business records | Sample, plan and QC metadata | Records **do not execute** production or transfer stock |

## Next technical work: normalized garment entities

Do **not** represent independent size/color SKUs as only JSON business attributes. After validating the current catalog and inventory constraints, design and review migrations for:

1. `garment_styles`: organization_id, style_code, season, collection, approved sample, base product.
2. `garment_variants`: style_id, size_id, color_id, sku, barcode, finished-product identity. Unique organization/SKU and style/size/color.
3. `fabric_rolls`: raw_material_id, warehouse_id, supplier lot, shade/dye lot, width, original/remaining metres, unit cost.
4. `garment_bom_versions` and `garment_bom_lines`: approved style/version, fabric/trim requirements, size-grade consumption, allowance/waste.
5. `garment_work_orders` with `garment_work_order_sizes`: customer order or plan, size/color quantity breakdown, due date, branch, state.
6. `garment_cutting_batches` and `garment_bundles`: cutting marker, planned vs actual fabric usage, bundle range, piece counts.
7. `garment_operations`, `garment_stage_events`, `garment_piecework`: cutting, sewing, finishing, ironing, packing, worker/line output and approved labor cost.
8. `garment_quality_checks` with defect codes, accepted/rework/rejected quantities.
9. Stock/GL posting functions for raw-material issue, WIP stage movement, finished-goods receipt and reversals; keep movement idempotent and auditable.

### Required invariants

- Every transactional row must be organization/branch scoped, with RLS, safe grants, and backend-enforced permissions.
- Parent/child scope must be checked server-side: styles, orders, lines, lots and warehouses must belong to the same authorized scope.
- A garment size/color variant must have its own SKU and physical stock identity.
- One cutting bundle may not be completed twice. Received/failed/reworked pieces must reconcile with issued pieces.
- Materials and inventory movement must be written transactionally via server functions with idempotency keys, not via unguarded browser updates.
- WIP valuation and unit cost must reconcile to raw materials, approved labor, subcontractor costs and allocated overhead.
- Never copy real customer or financial data to a test environment.

## Standalone copy / deployment

The source repository currently enforces a fixed Supabase database identity under `docs/DATABASE_IDENTITY_LOCK.md` and `docs/EXECUTION_GUARDRAILS.md`. **A new branch is not a standalone copy** and does not isolate database traffic.

To release PremierOS Garments as an independent app:

1. Create a *separate repository* and a *separate Supabase project* with its own Auth, storage, keys, migrations and secure deployment variables.
2. Review and intentionally regenerate repository/database identity checks for that new project; do not change the existing PremierOS production identity.
3. Apply approved migrations only in the *new* environment, verify schema, RLS and cross-tenant tests, and run smoke tests with synthetic test data.
4. Create a separate Vercel project and domain, then enable deployments independently from the original PremierOS.
5. Enable production workflows only after permissions, stock reconciliation, reversal logic and cost checks pass.

**This branch does not apply migrations, connect to a new database, create a new Vercel deployment, or implement full factory workflows.**

## Suggested acceptance cases for the next milestone

- One style with two colors and four sizes creates eight unique SKUs; no collisions.
- Issue 100m of fabric from an identified roll; the roll balance and ledger agree.
- Cut 200 pieces, transfer 190 to sewing, reject 5, record 5 as pending: counts reconcile exactly.
- Complete a work order once; retrying the same posting cannot duplicate finished inventory or accounting entries.
- A user from a different organization, branch or warehouse cannot view or mutate any of those records.
