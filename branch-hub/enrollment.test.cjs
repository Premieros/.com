'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createCloudClient,PROJECT_URL,PROJECT_REF}=require('./cloud-client.cjs');
const {createConfigVault}=require('./config-vault.cjs');
const {createEnrollmentController}=require('./enrollment.cjs');
const org='11111111-1111-4111-8111-111111111111',branch='22222222-2222-4222-8222-222222222222',userId='33333333-3333-4333-8333-333333333333';
function storage(){
 const secret=crypto.randomBytes(32);
 return {isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test',
  encryptString(text){const nonce=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secret,nonce);return Buffer.concat([nonce,c.update(text),c.final(),c.getAuthTag()]);},
  decryptString(bytes){const d=crypto.createDecipheriv('aes-256-gcm',secret,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(-16));return Buffer.concat([d.update(bytes.subarray(12,-16)),d.final()]).toString();}};
}
function cloudMock(){
 const calls=[];let allowed=true;
 const client=createCloudClient(async(url,options)=>{
  calls.push({url,options});assert.equal(new URL(url).origin,PROJECT_URL);assert.equal(options.redirect,'error');
  const route=new URL(url).pathname;
  let result=route==='/auth/v1/token'?{access_token:'signed-test-session-token-long',refresh_token:'signed-test-refresh-token'}:
   route==='/auth/v1/user'?{id:userId}:
   route==='/rest/v1/rpc/can_permission'?allowed:
   route==='/rest/v1/rpc/is_platform_admin'?false:
   route==='/rest/v1/branches'?[{id:branch,organization_id:org,name:'Branch 1',is_active:true}]:null;
  assert.notEqual(result,null);return {ok:true,status:200,json:async()=>result};
 });
 return {client,calls,revoke(){allowed=false;}};
}
test('cloud enrollment pins project, checks RLS permission twice and never returns cloud tokens to UI',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-enrollment-'));
 try{
  const mock=cloudMock(),vault=createConfigVault(dir,storage());
  const controller=createEnrollmentController({client:mock.client,vault,dataDir:path.join(dir,'data')});
  const result=await controller.signIn({email:'admin@example.test',password:'test-password'});
  assert.equal(result.accessToken,undefined);assert.equal(result.branches[0].id,branch);
  assert.equal(mock.calls[0].options.body,JSON.stringify({email:'admin@example.test',password:'test-password'}));
  mock.revoke();await assert.rejects(controller.enroll(branch),/BRANCH_ADMIN_REQUIRED/);
  assert.equal(fs.existsSync(vault.file),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('verified first-run binding is encrypted, cannot be replaced, and persists without cloud password/session',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-vault-'));
 try{
  const vault=createConfigVault(dir,storage());
  const controller=createEnrollmentController({client:cloudMock().client,vault,dataDir:path.join(dir,'data')});
  await controller.signIn({email:'admin@example.test',password:'super-secret-password'});
  await assert.rejects(controller.enroll('44444444-4444-4444-8444-444444444444'),/BRANCH_ACCESS_DENIED/);
  const config=await controller.enroll(branch);
  assert.equal(config.projectRef,PROJECT_REF);assert.equal(config.organizationId,org);assert.equal(config.branchId,branch);
  assert.equal(vault.load().token,config.token);assert.equal(config.enrolledBy,userId);
  const disk=fs.readFileSync(vault.file,'utf8');
  for(const value of [config.token,org,branch,'super-secret-password','signed-test-session-token-long','signed-test-refresh-token'])assert.equal(disk.includes(value),false);
  assert.equal(config.accessToken,undefined);assert.equal(config.password,undefined);
  assert.throws(()=>vault.save({...config,branchId:'other_branch'}),/EEXIST/);
  await assert.rejects(controller.enroll(branch),/LOGIN_REQUIRED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('legacy configuration migrates only after encryption verification; unavailable OS vault refuses plaintext fallback',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-legacy-'));
 try{
  const legacy={organizationId:'old_org',branchId:'old_branch',token:'t'.repeat(40),printers:{cashier:{host:'192.168.1.2',port:9100}}};
  const file=path.join(dir,'branch-config.json');fs.writeFileSync(file,JSON.stringify(legacy));
  const unavailable=createConfigVault(dir,{isEncryptionAvailable:()=>false});
  assert.throws(()=>unavailable.loadOrMigrate(),/OS_CREDENTIAL_VAULT_UNAVAILABLE/);assert.equal(fs.existsSync(file),true);
  const vault=createConfigVault(dir,storage());const migrated=vault.loadOrMigrate();assert.match(migrated.backupKey,/^[0-9a-f]{64}$/);delete migrated.backupKey;assert.deepEqual(migrated,legacy);assert.equal(fs.existsSync(file),false);
  const unsafe=createConfigVault(dir,{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text'},'linux');
  assert.throws(()=>unsafe.load(),/OS_CREDENTIAL_VAULT_UNAVAILABLE/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('enrollment cannot switch an existing SQLite branch or accept a stale login',async()=>{
 const {createHub}=require('./server.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-binding-enroll-'));
 const dataDir=path.join(dir,'data');
 const hub=createHub({port:0,dataDir,organizationId:'old_org',branchId:'old_branch',token:'a'.repeat(40)});
 await hub.listen();await hub.close();
 try{
  let time=0;const vault=createConfigVault(dir,storage());
  const controller=createEnrollmentController({client:cloudMock().client,vault,dataDir,clock:()=>time});
  await controller.signIn({email:'admin@example.test',password:'test'});time=6*60*1000;
  await assert.rejects(controller.enroll(branch),/LOGIN_REQUIRED/);time=0;
  await controller.signIn({email:'admin@example.test',password:'test'});
  await assert.rejects(controller.enroll(branch),/BRANCH_BINDING_MISMATCH/);assert.equal(fs.existsSync(vault.file),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('re-enrollment after backup restore preserves installation identity used for cloud replay',async()=>{
 const {createHub}=require('./server.cjs');
 const {restoreToEmptyDirectory}=require('./restore.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-installation-restore-'));
 const installation='55555555-5555-4555-8555-555555555555';
 const hub=createHub({port:0,dataDir:path.join(root,'source'),organizationId:org,branchId:branch,installationId:installation,token:'a'.repeat(40)});
 try{
  await hub.listen();const snapshot=path.join(root,'source','backups',hub.createLocalBackup().filename);
  const dataDir=path.join(root,'restored');restoreToEmptyDirectory({backupPath:snapshot,dataDir,organizationId:org,branchId:branch});
  const vault=createConfigVault(path.join(root,'new-profile'),storage());
  const controller=createEnrollmentController({client:cloudMock().client,vault,dataDir});
  await controller.signIn({email:'admin@example.test',password:'test'});
  const result=await controller.enroll(branch);assert.equal(result.hubDeviceId,installation);
 }finally{await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});
