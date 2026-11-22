# Performance review for Premier

- Measure first usable data separately from the loading placeholder. Record cold and warm loads, request count, transferred bytes, and median and p95 for POS, kitchen, reports, and the ordering menu. Use test data for concurrent-user runs. Production observation can use passive request statistics.
- Scope data reads by branch and permission. Use bounded pages for lists and a deterministic sort. Show early data when the workflow can use it, and publish totals and exports only for their full intended scope. Preserve existing filters.
- Inspect repeated requests per item. Reuse joined or bulk reads for the visible set. Coalesce duplicate live refreshes and retain a trailing refresh for events that arrive during a read. Cap parallel branch reads without silently omitting branches.
- Check indexes and the actual query plan on representative data before adding an index. Include the impact on insert and update paths.
- Keep public media cache short when editors can replace images. Keep private cache isolated by user and branch, and clear data after denied access. Resolve stock, order changes, and payment authoritatively before writing.
- Compress large still photos before upload if the smaller version is supported. Prioritize the main photo and first visible cards. Lazy-load the rest and reserve their layout space. Account for existing images separately.
- Render an accessible placeholder matching the screen during the initial load. Keep retry, denied-access, and empty states distinguishable.
