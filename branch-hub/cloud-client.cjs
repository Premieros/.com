'use strict';
// Public project identity. This is a publishable client key, never a Service Role key.
const PROJECT_REF='hvqlkapynjfjikqithvd';
const PROJECT_URL=`https://${PROJECT_REF}.supabase.co`;
const PUBLISHABLE_KEY='sb_publishable_9W6651rcdIsyBoegwGe_qw_MvCPRIPK';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createCloudClient(fetchImpl=fetch) {
 async function request(route,{accessToken,body,method,prefer}={}) {
  if(!route.startsWith('/auth/v1/')&&!route.startsWith('/rest/v1/'))throw Error('INVALID_CLOUD_ROUTE');
  let response;
  try {response=await fetchImpl(PROJECT_URL+route,{
   method:method||(body?'POST':'GET'),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
   headers:{apikey:PUBLISHABLE_KEY,'content-type':'application/json',...(prefer?{prefer}:{}),...(accessToken?{authorization:'Bearer '+accessToken}:{})},
   body:body?JSON.stringify(body):undefined,
  });}catch{throw Error('CLOUD_UNAVAILABLE');}
  if(!response.ok)throw Error(response.status===401||response.status===403?'CLOUD_ACCESS_DENIED':'CLOUD_REQUEST_FAILED');
  return response.status===204?null:response.json();
 }
 async function user(accessToken) {
  const result=await request('/auth/v1/user',{accessToken});
  if(!UUID.test(result?.id||'') || result.is_anonymous===true)throw Error('CLOUD_ACCOUNT_REQUIRED');
  return {id:result.id};
 }
 async function assertAdministrator(accessToken){
  await user(accessToken);
  const allowed=await request('/rest/v1/rpc/can_permission',{accessToken,body:{p_permission:'branches.manage'}});
  if(allowed!==true && await request('/rest/v1/rpc/is_platform_admin',{accessToken,method:'POST',body:{}})!==true)throw Error('BRANCH_ADMIN_REQUIRED');
 }
 async function branches(accessToken){
  await assertAdministrator(accessToken);
  const rows=await request('/rest/v1/branches?select=id,organization_id,name,is_active&is_active=eq.true&order=name&limit=1000',{accessToken});
  if(!Array.isArray(rows)||rows.length>=1000)throw Error('BRANCH_LIST_REQUIRES_PAGINATION');
  if(rows.some(r=>!UUID.test(r.id)||!UUID.test(r.organization_id)||r.is_active!==true||typeof r.name!=='string'))throw Error('INVALID_CLOUD_BRANCH');
  return rows.map(r=>({id:r.id,organizationId:r.organization_id,name:r.name}));
 }
 async function signIn({email,password}){
  if(typeof email!=='string'||email.length>320||!email.includes('@')||typeof password!=='string'||password.length<1||password.length>1024)throw Error('INVALID_LOGIN');
  const auth=await request('/auth/v1/token?grant_type=password',{body:{email,password}});
  if(typeof auth?.access_token!=='string'||auth.access_token.length<20||typeof auth.refresh_token!=='string'||auth.refresh_token.length<8)throw Error('INVALID_CLOUD_SESSION');
  const actor=await user(auth.access_token);
  const choices=await branches(auth.access_token);
  return {accessToken:auth.access_token,refreshToken:auth.refresh_token,userId:actor.id,branches:choices};
 }
 async function validateEnrollment(accessToken,branchId){
  if(!UUID.test(branchId||''))throw Error('INVALID_BRANCH');
  const actor=await user(accessToken);
  const choices=await branches(accessToken); // Recheck RLS/permission at confirmation, not only login.
  const branch=choices.find(r=>r.id===branchId);
  if(!branch)throw Error('BRANCH_ACCESS_DENIED');
  return {...branch,enrolledBy:actor.id,projectRef:PROJECT_REF};
 }
 return {request,signIn,branches,user,validateEnrollment};
}
module.exports={createCloudClient,PROJECT_REF,PROJECT_URL,UUID};
