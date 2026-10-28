-- Index only the new replication tables; keep tenant cleanup/cascades from scanning unrelated rows.
CREATE INDEX branch_hub_replicated_sales_org_idx ON public.branch_hub_replicated_sales(organization_id);
CREATE INDEX branch_hub_price_commands_org_idx ON public.branch_hub_price_commands(organization_id);
CREATE INDEX branch_hub_command_receipts_command_idx ON public.branch_hub_command_receipts(command_id);
