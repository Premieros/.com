'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCloudClient,PROJECT_URL}=require('./cloud-client.cjs');
const ok=value=>({ok:true,status:200,json:async()=>value});
test('only safe reads and permission checks retry transient network/server failures',async()=>{
 for(const route of ['/auth/v1/user','/rest/v1/rpc/can_permission']){
  let calls=0;const client=createCloudClient(async(url,options)=>{assert.equal(new URL(url).origin,PROJECT_URL);assert.equal(options.redirect,'error');if(++calls===1)return {ok:false,status:503};return ok(true);},{retryDelayMs:0});
  assert.equal(await client.request(route,{...(route.includes('rpc')?{body:{p_permission:'branches.manage'}}:{}),phase:'permission'}),true);assert.equal(calls,2);
 }
 for(const route of ['/auth/v1/token?grant_type=password','/auth/v1/token?grant_type=refresh_token','/rest/v1/rpc/financial_operation']){
  let calls=0;const client=createCloudClient(async()=>{calls++;throw Error('network');},{retryDelayMs:0});
  await assert.rejects(client.request(route,{body:{}}),/CLOUD_UNAVAILABLE/);assert.equal(calls,1);
 }
});
test('TLS, denied access, rate limits and malformed responses fail closed without retry',async()=>{
 for(const [response,code,status] of [[{ok:false,status:403},'CLOUD_ACCESS_DENIED',403],[{ok:false,status:429},'CLOUD_RATE_LIMITED',429],[{ok:true,status:200,json:async()=>{throw Error('secret server text');}},'CLOUD_INVALID_RESPONSE',undefined],[null,'CLOUD_TLS_FAILED',undefined]]){
  let calls=0;const client=createCloudClient(async()=>{calls++;if(!response)throw Object.assign(Error('certificate'),{cause:{code:'CERT_HAS_EXPIRED'}});return response;},{retryDelayMs:0});
  await assert.rejects(client.request('/auth/v1/user',{phase:'account'}),e=>e.message===code&&e.phase==='account'&&e.status===status);assert.equal(calls,1);
 }
});
test('persistent DNS and timeout errors retain safe phase diagnostics',async()=>{
 for(const [cause,code] of [[Object.assign(Error('dns'),{cause:{code:'ENOTFOUND'}}),'CLOUD_DNS_FAILED'],[Object.assign(Error('timeout'),{name:'TimeoutError'}),'CLOUD_TIMEOUT']]){
  let calls=0;const client=createCloudClient(async()=>{calls++;throw cause;},{retryDelayMs:0});await assert.rejects(client.request('/auth/v1/user',{phase:'account'}),e=>e.message===code&&e.phase==='account');assert.equal(calls,2);
 }
});
