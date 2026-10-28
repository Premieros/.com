'use strict';
// Public project identity. This is a publishable client key, never a Service Role key.
const PROJECT_REF='hvqlkapynjfjikqithvd';
const PROJECT_URL=`https://${PROJECT_REF}.supabase.co`;
const PUBLISHABLE_KEY='sb_publishable_9W6651rcdIsyBoegwGe_qw_MvCPRIPK';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function classifyConnectionError(error){
 const code=String(error?.cause?.code||error?.code||''),name=String(error?.name||''),message=String(error?.message||'');
 if(/CERT|SSL|TLS|SELF_SIGNED/.test(code)||/ERR_CERT_|ERR_SSL_/.test(message))return 'CLOUD_TLS_FAILED';
 if(/ENOTFOUND|EAI_AGAIN/.test(code)||/ERR_NAME_NOT_RESOLVED/.test(message))return 'CLOUD_DNS_FAILED';
 if(/Timeout|Abort/.test(name)||/TIMEOUT|TIMEDOUT/.test(code)||/ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/.test(message))return 'CLOUD_TIMEOUT';
 return 'CLOUD_UNAVAILABLE';
}
function createCloudClient(fetchImpl=fetch,{retryDelayMs=250}={}) {
 async function request(route,{accessToken,body,method,prefer,phase='cloud'}={}) {
  if(!route.startsWith('/auth/v1/')&&!route.startsWith('/rest/v1/'))throw Error('INVALID_CLOUD_ROUTE');
  const verb=method||(body?'POST':'GET');
  // Password and rotating refresh-token requests are never automatically replayed.
  const safe=verb==='GET'||['/rest/v1/rpc/can_permission','/rest/v1/rpc/is_platform_admin'].includes(route);
  for(let attempt=0;attempt<(safe?2:1);attempt++){
   try{
    let response;
    try{response=await fetchImpl(PROJECT_URL+route,{
     method:verb,redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000),
     headers:{apikey:PUBLISHABLE_KEY,'content-type':'application/json',...(prefer?{prefer}:{}),...(accessToken?{authorization:'Bearer '+accessToken}:{})},
     body:body?JSON.stringify(body):undefined,
    });}catch(cause){const error=Error(classifyConnectionError(cause));error.retryable=error.message!=='CLOUD_TLS_FAILED';throw error;}
    if(!response.ok){
     const code=response.status===401||response.status===403?'CLOUD_ACCESS_DENIED':response.status===429?'CLOUD_RATE_LIMITED':[502,503,504].includes(response.status)?'CLOUD_TEMPORARY_ERROR':'CLOUD_REQUEST_FAILED';
     const error=Error(code);error.status=response.status;error.retryable=[502,503,504].includes(response.status);throw error;
    }
    if(response.status===204)return null;
    try{return await response.json();}catch{throw Error('CLOUD_INVALID_RESPONSE');}
   }catch(error){
    error.phase=phase;
    if(!safe||attempt!==0||!error.retryable)throw error;
    if(retryDelayMs>0)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
   }
  }
 }
 async function user(accessToken) {
  const result=await request('/auth/v1/user',{accessToken,phase:'account'});
  if(!UUID.test(result?.id||'') || result.is_anonymous===true)throw Error('CLOUD_ACCOUNT_REQUIRED');
  return {id:result.id};
 }
 async function assertAdministrator(accessToken){
  const actor=await user(accessToken);
  const allowed=await request('/rest/v1/rpc/can_permission',{accessToken,body:{p_permission:'branches.manage'},phase:'permission'});
  if(allowed!==true && await request('/rest/v1/rpc/is_platform_admin',{accessToken,method:'POST',body:{},phase:'permission'})!==true)throw Error('BRANCH_ADMIN_REQUIRED');
  return actor;
 }
 async function loadBranches(accessToken){
  const rows=await request('/rest/v1/branches?select=id,organization_id,name,is_active&is_active=eq.true&order=name&limit=1000',{accessToken,phase:'branch'});
  if(!Array.isArray(rows)||rows.length>=1000)throw Error('BRANCH_LIST_REQUIRES_PAGINATION');
  if(rows.some(r=>!UUID.test(r.id)||!UUID.test(r.organization_id)||r.is_active!==true||typeof r.name!=='string'))throw Error('INVALID_CLOUD_BRANCH');
  return rows.map(r=>({id:r.id,organizationId:r.organization_id,name:r.name}));
 }
 async function branches(accessToken){await assertAdministrator(accessToken);return loadBranches(accessToken);}
 async function signIn({email,password}){
  if(typeof email!=='string'||email.length>320||!email.includes('@')||typeof password!=='string'||password.length<1||password.length>1024)throw Error('INVALID_LOGIN');
  const auth=await request('/auth/v1/token?grant_type=password',{body:{email,password},phase:'sign_in'});
  if(typeof auth?.access_token!=='string'||auth.access_token.length<20||typeof auth.refresh_token!=='string'||auth.refresh_token.length<8)throw Error('INVALID_CLOUD_SESSION');
  const actor=await assertAdministrator(auth.access_token);
  const choices=await loadBranches(auth.access_token);
  return {accessToken:auth.access_token,refreshToken:auth.refresh_token,userId:actor.id,branches:choices};
 }
 async function validateEnrollment(accessToken,branchId){
  if(!UUID.test(branchId||''))throw Error('INVALID_BRANCH');
  const actor=await assertAdministrator(accessToken); // Fresh permission/user validation remains mandatory.
  const rows=await request('/rest/v1/branches?select=id,organization_id,name,is_active&is_active=eq.true&id=eq.'+branchId+'&limit=1',{accessToken,phase:'branch'});
  if(!Array.isArray(rows)||rows.length!==1||rows[0].id!==branchId||rows[0].is_active!==true||!UUID.test(rows[0].organization_id)||typeof rows[0].name!=='string')throw Error('BRANCH_ACCESS_DENIED');
  const branch={id:rows[0].id,organizationId:rows[0].organization_id,name:rows[0].name};
  return {...branch,enrolledBy:actor.id,projectRef:PROJECT_REF};
 }
 return {request,signIn,branches,user,validateEnrollment};
}
module.exports={createCloudClient,PROJECT_REF,PROJECT_URL,UUID,classifyConnectionError};
