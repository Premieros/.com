-- Asynchronous, audit-friendly full tenant deletion. Requesting a deletion is
-- fast; pg_cron performs the expensive atomic deletion outside PostgREST's
-- 60s HTTP limit. Migration itself never queues or deletes a tenant.
-- Supabase Cron recommends background jobs shorter than ten minutes.

CREATE TABLE IF NOT EXISTS private.organization_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  organization_name text NOT NULL,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','succeeded','failed')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  finished_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  error_code text,
  result jsonb,
  CONSTRAINT org_deletion_job_requester_fk
    FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_deletion_jobs_one_active_org
  ON private.organization_deletion_jobs(organization_id)
  WHERE status IN ('queued','claimed');

CREATE INDEX IF NOT EXISTS organization_deletion_jobs_processing_idx
  ON private.organization_deletion_jobs(status,requested_at);

ALTER TABLE private.organization_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.organization_deletion_jobs FROM PUBLIC,anon,authenticated,service_role;

-- The fast request function is the only entry point available to the client.
-- It checks an independent authenticated Super Admin, exact tenant name,
-- typed confirmation, a row lock and all cross-tenant preflight blockers.
CREATE OR REPLACE FUNCTION public.super_admin_queue_organization_deletion(
  p_organization_id uuid, p_confirm_name text, p_confirm_phrase text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $fn$
DECLARE v_org public.organizations%ROWTYPE;
  v_preview jsonb;
  v_job private.organization_deletion_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id=auth.uid() AND role='super_admin' AND is_active AND branch_id IS NULL
  ) THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_organization_id IS NULL OR p_confirm_phrase IS DISTINCT FROM 'DELETE' THEN
    RETURN jsonb_build_object('success',false,'error','CONFIRMATION_REQUIRED');
  END IF;
  SELECT * INTO v_org FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NOT_FOUND'); END IF;
  IF v_org.name IS DISTINCT FROM p_confirm_name THEN
    RETURN jsonb_build_object('success',false,'error','ORGANIZATION_NAME_MISMATCH');
  END IF;
  SELECT * INTO v_job FROM private.organization_deletion_jobs
    WHERE organization_id=p_organization_id AND status IN ('queued','claimed')
    ORDER BY requested_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success',true,'job_id',v_job.id,'status',v_job.status);
  END IF;
  v_preview:=private.organization_full_deletion_preflight(p_organization_id);
  IF NOT COALESCE((v_preview->>'eligible')::boolean,false) THEN
    RETURN jsonb_build_object('success',false,'error','CROSS_ORGANIZATION_DEPENDENCIES','preview',v_preview);
  END IF;
  INSERT INTO private.organization_deletion_jobs(
    organization_id,organization_name,requested_by
  ) VALUES(p_organization_id,v_org.name,auth.uid()) RETURNING * INTO v_job;
  RETURN jsonb_build_object('success',true,'job_id',v_job.id,'status','queued');
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_job FROM private.organization_deletion_jobs
    WHERE organization_id=p_organization_id AND status IN ('queued','claimed') LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('success',true,'job_id',v_job.id,'status',v_job.status); END IF;
  RETURN jsonb_build_object('success',false,'error','REQUEST_CONFLICT');
END;
$fn$;

-- Polling/reloading only needs the organization ID; global admins alone
-- can see the latest request. There is no private table access from REST.
CREATE OR REPLACE FUNCTION public.super_admin_organization_deletion_status(
  p_organization_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $fn$
DECLARE v_job private.organization_deletion_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id=auth.uid() AND role='super_admin' AND is_active AND branch_id IS NULL
  ) THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  SELECT * INTO v_job FROM private.organization_deletion_jobs
    WHERE organization_id=p_organization_id ORDER BY requested_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'status','none');
  END IF;
  RETURN jsonb_build_object('success',true,'job_id',v_job.id,
    'status',v_job.status,'error',v_job.error_code,
    'requested_at',v_job.requested_at,'finished_at',v_job.finished_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_queue_organization_deletion(uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.super_admin_organization_deletion_status(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_queue_organization_deletion(uuid,text,text),
  public.super_admin_organization_deletion_status(uuid) TO authenticated;

-- Claim is a separate, short transaction so any later SQL cancellation
-- cannot silently return a claimed job to the queued state.
CREATE OR REPLACE FUNCTION private.claim_organization_deletion_job()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public','private','pg_temp'
SET statement_timeout TO '15s'
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'INTERNAL_WORKER_ONLY';
  END IF;
  -- Cron workers should finish within eight minutes. Jobs held for over
  -- twelve minutes and not row-locked are considered timed out, not retried
  -- automatically. A Super Admin may re-submit after inspection.
  WITH stale AS (
    SELECT id FROM private.organization_deletion_jobs
    WHERE status='claimed' AND claimed_at < clock_timestamp()-interval '12 minutes'
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.organization_deletion_jobs j
    SET status='failed',finished_at=clock_timestamp(),error_code='WORKER_TIMEOUT'
  WHERE j.id IN (SELECT id FROM stale);

  IF EXISTS (SELECT 1 FROM private.organization_deletion_jobs
      WHERE status='claimed') THEN RETURN 0; END IF;

  SELECT id INTO v_id FROM private.organization_deletion_jobs
    WHERE status='queued' AND attempts=0
    ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN 0; END IF;
  UPDATE private.organization_deletion_jobs
     SET status='claimed', claimed_at=clock_timestamp(),attempts=attempts+1
     WHERE id=v_id;
  RETURN 1;
END;
$fn$;

-- Only the cron-owned postgres session can process a previously authorized
-- request. The submitted requester is revalidated at execution time.
-- JWT context is set transaction-local by this server-only worker, so the
-- existing tenant purge and all its trigger guards execute unchanged.
CREATE OR REPLACE FUNCTION private.execute_claimed_organization_deletion()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public','private','pg_temp'
SET statement_timeout TO '8min'
AS $fn$
DECLARE v_job private.organization_deletion_jobs%ROWTYPE;
  v_result jsonb;
  v_code text;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'INTERNAL_WORKER_ONLY';
  END IF;
  SELECT * INTO v_job FROM private.organization_deletion_jobs
    WHERE status='claimed'
      AND claimed_at > clock_timestamp()-interval '3 minutes'
    ORDER BY requested_at
    FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('processed',false); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
      WHERE id=v_job.requested_by AND role='super_admin'
      AND is_active AND branch_id IS NULL
  ) THEN
    UPDATE private.organization_deletion_jobs SET status='failed',
      error_code='REQUESTER_NOT_SUPER_ADMIN',finished_at=clock_timestamp()
      WHERE id=v_job.id;
    RETURN jsonb_build_object('processed',true,'success',false);
  END IF;
  -- No impersonation from REST clients is possible: this function is
  -- private, SECURITY INVOKER, and only a postgres cron session may run it.
  PERFORM set_config('app.user_id',v_job.requested_by::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_job.requested_by::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',v_job.requested_by::text,'role','authenticated')::text,true);

  v_result:=public.super_admin_delete_organization(
    v_job.organization_id,v_job.organization_name,'DELETE');
  IF COALESCE((v_result->>'success')::boolean,false)
    AND NOT EXISTS (
      SELECT 1 FROM public.organizations WHERE id=v_job.organization_id
    ) THEN
    UPDATE private.organization_deletion_jobs SET status='succeeded',
      finished_at=clock_timestamp(),result=v_result,error_code=NULL
      WHERE id=v_job.id;
    RETURN jsonb_build_object('processed',true,'success',true);
  END IF;

  v_code:=COALESCE(v_result->>'error','DELETION_NOT_CONFIRMED');
  UPDATE private.organization_deletion_jobs SET status='failed',
    finished_at=clock_timestamp(),error_code=v_code,result=v_result
    WHERE id=v_job.id;
  RETURN jsonb_build_object('processed',true,'success',false,'error',v_code);
EXCEPTION WHEN OTHERS THEN
  -- The nested exception rollback protects all tenant data. Only a generic
  -- code is shown in the UI, while SQL details remain in server logs.
  UPDATE private.organization_deletion_jobs SET status='failed',
    finished_at=clock_timestamp(),error_code='WORKER_DATABASE_ERROR'
    WHERE id=v_job.id;
  RAISE WARNING 'Organization deletion worker failed, SQLSTATE %: %',SQLSTATE,SQLERRM;
  RETURN jsonb_build_object('processed',true,'success',false,'error','WORKER_DATABASE_ERROR');
END;
$fn$;

REVOKE ALL ON FUNCTION private.claim_organization_deletion_job()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.execute_claimed_organization_deletion()
  FROM PUBLIC,anon,authenticated,service_role;

-- The old HTTP RPC had a 60s function-local timeout. Drop it so the trusted
-- eight-minute cron worker's session setting applies to the nested call.
ALTER FUNCTION public.super_admin_delete_organization(uuid,text,text)
  RESET statement_timeout;

-- Cron is optional in the local CI database, required in production.
-- These statements schedule processors only, NOT any specific tenant.
DO $fn$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('super-admin-deletion-claim-v1','* * * * *',
      'SELECT private.claim_organization_deletion_job();');
    PERFORM cron.schedule('super-admin-deletion-process-v1','* * * * *',
      'SELECT private.execute_claimed_organization_deletion();');
  END IF;
END;
$fn$;
