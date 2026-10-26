# Missing published price policy — applied 2026-10-23

Scope: Premieros/.com; Supabase project hvqlkapynjfjikqithvd ONLY.

Business instruction: **No published price means raw material costing equals 0.** The user is responsible for publishing prices before expecting accurate recipe costs. Do not silently infer cost from purchases, FIFO, batch averages, inventory averages, or raw_materials.default_cost.

Applied migration `zero_raw_cost_when_no_published_price` updates `public._raw_cost_context_for_costing(uuid,uuid)`:
- Most recent positive `raw_material_price_events` for matching material and branch, dated no later than now, is used.
- When absent, returns `unit_cost:0` and `source:'no_published_price'`.
- No mutation to posted journals or historical stock transactions.
- Existing `_raw_cost_for_costing` delegates to this helper.

Verified direct query with nonzero default_costs (0.38 and 50.00) returned effective_cost=0 and source=no_published_price. At audit time `raw_material_price_events` had zero rows; therefore every raw material lacking a published event currently returns zero by this helper.

Remaining engineering: clearly flag unpriced recipe components in UI; prevent confusing zero cost with a confidently valued product; test existing checkout and COGS/snapshot paths for other costing sources. FIFO runtime removal remains unfinished.