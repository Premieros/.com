# As-of transaction published raw material cost — 2026-10-23

Target Premieros/.com; Supabase hvqlkapynjfjikqithvd.

Applied migration `published_cost_asof_event_v2` creates private.raw_published_unit_cost_at_v2(raw_material_id uuid, branch_id uuid, at timestamptz). SQL STABLE SECURITY INVOKER, restricted to service_role. It selects latest positive raw_material_price_events where priced_at <= p_at, tie break priced_at DESC,id DESC, exact branch; missing events yield unit_cost:0,source:no_published_price. Missing material or wrong branch returns MATERIAL_BRANCH_MISMATCH.

Verified missing published price returns 0 and cross-branch fails. No synthetic price-history fixture was inserted yet, so selection of multiple published prices has not been tested. No historical COGS was rewritten; checkout is not yet wired to this helper. Previously staged movement v2 remains disabled against production writes while legacy FIFO operates.

Next: concurrency/load tests and integration with stock postings, sales and accounting prior to removing FIFO engine.