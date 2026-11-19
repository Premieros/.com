#!/usr/bin/env node
// Aggregate-only auth/branch entitlement audit. Does not read emails into output.
// Do not assign identities, disable employees or grant permissions from this tool.
import {fileURLToPath} from 'node:url';
import {assertTarget} from './audit-production.mjs';

export const ACCESS_QUERIES = {
  identities: `with missing as (
    select u.id,u.email,u.role from public.users u
    left join auth.users a on a.id=u.id where u.is_active and a.id is null
  ) select
    (select count(*) from public.users) as profile_count,
    (select count(*) from auth.users) as auth_count,
    count(*) as active_missing_auth,
    count(*) filter(where exists(
      select 1 from auth.users a
      where nullif(trim(missing.email),'') is not null
      and lower(trim(a.email))=lower(trim(missing.email))
    )) as email_match_different_identity,
    count(*) filter(where not exists(
      select 1 from auth.users a
      where nullif(trim(missing.email),'') is not null
      and lower(trim(a.email))=lower(trim(missing.email))
    )) as no_matching_auth_email,
    count(*) filter(where role in ('super_admin','owner','branch_manager')) as missing_privileged_profiles
    from missing`,
  memberships: `select
    (select count(*) from public.organization_members) as membership_count,
    (select count(*) from public.organization_members m
       left join auth.users a on a.id=m.user_id
       where m.is_active and a.id is null) as active_members_missing_auth,
    (select count(*) from public.branches b where not exists(
       select 1 from public.organization_members m
       where m.organization_id=b.organization_id and m.is_active
    )) as branches_without_active_org_member,
    (select count(distinct b.organization_id) from public.branches b where not exists(
       select 1 from public.organization_members m
       where m.organization_id=b.organization_id and m.is_active
    )) as affected_organizations`,
  branch_access: `select count(*) as access_count,
    count(*) filter(where a.id is null) as links_without_auth,
    count(*) filter(where u.id is null) as links_without_profile,
    count(*) filter(where b.id is null) as links_without_branch
    from public.user_branch_access x
    left join auth.users a on a.id=x.user_id
    left join public.users u on u.id=x.user_id
    left join public.branches b on b.id=x.branch_id`,
  policies: `select
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) as public_without_rls,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and has_table_privilege('anon',c.oid,'SELECT')) as anon_readable_tables,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
      and has_function_privilege('anon',p.oid,'EXECUTE')) as anonymous_security_definer_functions`
};

function nonnegative(value){
  const x=Number(value);
  if(!Number.isSafeInteger(x)||x<0)throw Error('INVALID_AGGREGATE');
  return x;
}

export function classifyAccess(s){
  if(!s||!s.identities||!s.memberships||!s.branch_access||!s.policies)
    throw Error('INVALID_SNAPSHOT');
  const checks = [
    ['active_missing_auth', s.identities.active_missing_auth, 'BLOCKER'],
    ['email_match_different_identity', s.identities.email_match_different_identity, 'REVIEW'],
    ['missing_privileged_profiles', s.identities.missing_privileged_profiles, 'BLOCKER'],
    ['active_members_missing_auth', s.memberships.active_members_missing_auth, 'BLOCKER'],
    ['branches_without_active_org_member', s.memberships.branches_without_active_org_member, 'BLOCKER'],
    ['links_without_auth', s.branch_access.links_without_auth, 'BLOCKER'],
    ['links_without_profile', s.branch_access.links_without_profile, 'BLOCKER'],
    ['links_without_branch', s.branch_access.links_without_branch, 'BLOCKER'],
    ['public_without_rls', s.policies.public_without_rls, 'BLOCKER'],
    ['anon_readable_tables', s.policies.anon_readable_tables, 'BLOCKER'],
    ['anonymous_security_definer_functions', s.policies.anonymous_security_definer_functions, 'REVIEW']
  ].map(([id,count,severity])=>({
    id,count:nonnegative(count),status:nonnegative(count)===0?'PASS':severity
  }));
  return {
    decision:checks.some(x=>x.status==='BLOCKER')?'BLOCKED':
      checks.some(x=>x.status==='REVIEW')?'REVIEW_REQUIRED':'TECHNICAL_ACCESS_CHECKS_PASS',
    checks,
    customer_handoff_approved:false,
    actions_authorized:false,
    review_required:[
      'verify_staff_identity_with_customer_out_of_band',
      'resolve_account_email_collision_without_reusing_uuid',
      'verify_all_tenant_memberships_and_authorized_branch_grants',
      'test_privileged_signup_and_rpc_authorization'
    ]
  };
}

export async function auditAccess(args=process.argv.slice(2),env=process.env){
  const {ref,url}=assertTarget(args,env);
  const {default:pg}=await import('pg');
  const client=new pg.Client({connectionString:url,connectionTimeoutMillis:8000});
  await client.connect();let started=false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    started=true;
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const counts={};
    for(const [name,sql] of Object.entries(ACCESS_QUERIES)){
      const {rows}=await client.query(sql);
      if(rows.length!==1)throw Error('INVALID_AGGREGATE');
      counts[name]=rows[0];
    }
    await client.query('ROLLBACK');started=false;
    return {project_ref:ref,checked_at:new Date().toISOString(),...classifyAccess(counts),counts};
  } finally {
    if(started)await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  auditAccess().then(x=>{process.stdout.write(JSON.stringify(x,null,2)+'\n');
    process.exitCode=x.decision==='BLOCKED'?2:0;})
  .catch(e=>{const safe=['PROJECT_CONFIRMATION_REQUIRED','SUPABASE_DB_URL_REQUIRED',
    'INVALID_PROTOCOL','WRONG_PROJECT_CONNECTION','INVALID_AGGREGATE','INVALID_SNAPSHOT'];
    process.stderr.write((safe.includes(e.message)?e.message:'ACCESS_AUDIT_FAILED')+'\n');process.exitCode=1;});
}
