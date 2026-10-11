-- Phase 8C: opt in to a bounded DB-local scheduler where pg_cron is available.
-- The CI PostgreSQL image lacks pg_cron; production installation and job are
-- verified independently after deployment. No external delivery is implied.
-- The cron job runs with its creator's DB privileges (postgres), NOT as an API user.
do $setup$
declare
  v_job_id bigint;
begin
  if not exists(select 1 from pg_available_extensions where name='pg_cron') then
    raise notice 'PHASE8C_PG_CRON_UNAVAILABLE_SKIPPING_DB_LOCAL_SCHEDULE';
    return;
  end if;

  if current_user <> 'postgres' then
    raise exception 'PHASE8C_POSTGRES_OWNER_REQUIRED';
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  if exists(select 1 from cron.job where jobname='erp-domain-outbox-v2') then
    raise exception 'PHASE8C_JOB_ALREADY_EXISTS_REVIEW_FIRST';
  end if;

  select cron.schedule(
    'erp-domain-outbox-v2',
    '* * * * *',
    $command$select private.process_erp_domain_outbox_batch_v2('erp-cron-v2',20);$command$
  ) into v_job_id;

  if v_job_id is null then
    raise exception 'PHASE8C_SCHEDULE_FAILED';
  end if;
end;
$setup$;
