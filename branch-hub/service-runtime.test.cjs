'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {runService,validateServiceBinding,publishProtectedBinding}=require('./service-runtime.cjs');
function config(){return {binding:{projectRef:'hvqlkapynjfjikqithvd',organizationId:'11111111-1111-4111-8111-111111111111',branchId:'22222222-2222-4222-8222-222222222222',hubDeviceId:'33333333-3333-4333-8333-333333333333',token:'synthetic-service-admin-token-32-characters',backupKey:'a'.repeat(64),cloudRefreshToken:'old-synthetic-token'},dataDir:path.join(os.tmpdir(),'synthetic-service-data')};}
test('service binding refuses alternate hosted projects and missing enrollment/backup identity',()=>{
 assert.doesNotThrow(()=>validateServiceBinding(config()));
 for(const change of [{projectRef:'other-project'},{branchId:'other-branch'},{organizationId:''},{hubDeviceId:''},{backupKey:''},{token:'short'}])assert.throws(()=>validateServiceBinding({...config(),binding:{...config().binding,...change}}),/INVALID_SERVICE_BINDING/);
});
test('service owns the server and asset lifetime independently and persists rotating credentials before use',async()=>{
 const input=config(),closed=[];let parameters,saved;
 const service=await runService(input,{createHub:c=>{parameters=c;return {listen:async()=>({port:3847}),close:async()=>closed.push('hub')};},createBrowserAppServer:()=>({listen:async()=>'http://127.0.0.1:3848/',close:async()=>closed.push('assets')}),persistBinding:async c=>{saved=c;}});
 assert.equal(parameters.installationId,input.binding.hubDeviceId);assert.equal(parameters.dataDir,input.dataDir);assert.equal(service.port,3847);
 await parameters.persistRefreshToken('new-synthetic-cloud-token');assert.equal(saved.binding.cloudRefreshToken,'new-synthetic-cloud-token');assert.equal(input.binding.cloudRefreshToken,'new-synthetic-cloud-token');
 await service.close();assert.deepEqual(closed,['assets','hub']);
});
test('a failed vault rotation leaves the current credential intact and an asset bind failure closes the server',async()=>{
 const input=config();let parameters,closed=0;
 const service=await runService(input,{createHub:c=>{parameters=c;return {listen:async()=>({port:3847}),close:async()=>closed++};},createBrowserAppServer:()=>({listen:async()=>'http://127.0.0.1:3848/',close:async()=>{}}),persistBinding:async()=>{throw Error('VAULT_IO_FAILED');}});
 await assert.rejects(parameters.persistRefreshToken('new-but-not-persisted-token'),/VAULT_IO_FAILED/);assert.equal(input.binding.cloudRefreshToken,'old-synthetic-token');await service.close();
 await assert.rejects(runService(config(),{createHub:()=>({listen:async()=>({port:3847}),close:async()=>closed++}),createBrowserAppServer:()=>({listen:async()=>{throw Error('EADDRINUSE');},close:async()=>{}}),persistBinding:async()=>{}}),/EADDRINUSE/);assert.equal(closed,2);
});
test('protected configuration publication is atomic and leaves no staging files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'premier-service-vault-'));try{const file=path.join(root,'binding.dat');fs.writeFileSync(file,'old-ciphertext');publishProtectedBinding(file,'new-ciphertext');assert.equal(fs.readFileSync(file,'utf8'),'new-ciphertext');assert.deepEqual(fs.readdirSync(root),['binding.dat']);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
