create table if not exists private.journal_mutation_registry (
  function_signature text primary key,
  classification text not null check (classification in (
    'SAME_TRANSACTION_FINALIZATION',
    'TRANSITIONAL_RECONCILIATION',
    'HISTORICAL_REPAIR',
    'CONTROLLED_REVERSAL',
    'ADMIN_DESTRUCTIVE',
    'POSTED_RECLASSIFICATION'
  )),
  rationale text not null,
  remediation text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table private.journal_mutation_registry enable row level security;
revoke all on table private.journal_mutation_registry from public,anon,authenticated;
grant select on table private.journal_mutation_registry to service_role;

insert into private.journal_mutation_registry(
  function_signature,classification,rationale,remediation
)
values
('private.reconcile_credit_purchase_bank_history(uuid)','HISTORICAL_REPAIR','Historical repair updates journal entry_date after posting.','Retire after historical repair window is permanently closed.'),
('_fifo_adjust_orphan_sale_cogs_delta(uuid,uuid,numeric)','TRANSITIONAL_RECONCILIATION','Maintains mutable FIFO reconciliation journal lines and may delete zeroed shells.','Replace accumulator mutation with append-only reconciliation adjustments.'),
('_fifo_adjust_sale_cogs_delta(uuid,numeric)','TRANSITIONAL_RECONCILIATION','Maintains mutable FIFO sale reconciliation journal lines and may delete zeroed shells.','Replace accumulator mutation with append-only reconciliation adjustments.'),
('_fifo_adjust_stock_variance_delta(uuid,text,uuid,text,date,numeric)','TRANSITIONAL_RECONCILIATION','Maintains mutable FIFO stock reconciliation journal lines and may delete zeroed shells.','Replace accumulator mutation with append-only reconciliation adjustments.'),
('admin_data_delete_section(uuid,text)','ADMIN_DESTRUCTIVE','Explicit administrative data purge path.','Keep isolated behind work authorization; never use for ordinary financial correction.'),
('change_sale_payment_method(uuid,text,text)','POSTED_RECLASSIFICATION','Currently changes the account_id on an already-posted sale collection line.','Phase 5D: post a reclassification journal instead of editing the original sale journal.'),
('process_refund(uuid,jsonb,text)','SAME_TRANSACTION_FINALIZATION','Rewrites refund collection lines inside the same transaction that creates the refund journal.','Later model refund assembly as DRAFT then POSTED.'),
('process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)','SAME_TRANSACTION_FINALIZATION','Rewrites collection lines inside the same transaction that creates the sale journal.','Later model split settlement assembly as DRAFT then POSTED.'),
('raw_fifo_reverse_backfill(uuid)','HISTORICAL_REPAIR','Historical FIFO backfill rollback may delete zeroed reconciliation journal shells.','Retire after backfill lifecycle is permanently closed.'),
('reverse_journal_entry(uuid,text,date)','CONTROLLED_REVERSAL','Canonical Accounting V2 reversal updates only source posting_status and creates an offsetting journal.','Keep as the supported historical correction path.'),
('update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb)','SAME_TRANSACTION_FINALIZATION','Reversal/replacement workflow updates timestamps on journals created in the same correction transaction.','Move original-document date into creation arguments before owner-level immutable guard.')
on conflict(function_signature) do update
set classification=excluded.classification,
    rationale=excluded.rationale,
    remediation=excluded.remediation,
    active=true;

create or replace view private.journal_mutation_surface
as
with functions as (
  select
    n.nspname,
    p.oid::regprocedure::text as function_signature,
    p.proname,
    p.prosecdef,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
    and p.prokind='f'
),
mutators as (
  select
    f.*,
    (f.definition ilike '%update public.journal_entries%' or f.definition ilike '%update journal_entries%') as updates_entries,
    (f.definition ilike '%delete from public.journal_entries%' or f.definition ilike '%delete from journal_entries%') as deletes_entries,
    (f.definition ilike '%update public.journal_entry_lines%' or f.definition ilike '%update journal_entry_lines%') as updates_lines,
    (f.definition ilike '%delete from public.journal_entry_lines%' or f.definition ilike '%delete from journal_entry_lines%') as deletes_lines
  from functions f
)
select
  m.nspname,
  m.function_signature,
  m.proname,
  m.prosecdef,
  m.updates_entries,
  m.deletes_entries,
  m.updates_lines,
  m.deletes_lines,
  r.classification,
  r.rationale,
  r.remediation,
  (r.function_signature is null) as unclassified
from mutators m
left join private.journal_mutation_registry r
  on r.function_signature=m.function_signature
 and r.active
where m.updates_entries or m.deletes_entries or m.updates_lines or m.deletes_lines;

revoke all on table private.journal_mutation_surface from public,anon,authenticated;
grant select on table private.journal_mutation_surface to service_role;
