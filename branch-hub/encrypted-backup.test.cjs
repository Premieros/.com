'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHub}=require('./server.cjs');
const {createOfflineSalesEngine}=require('./offline-sales.cjs');
const {createBackupService}=require('./backup-service.cjs');
const {encryptBackup,decryptBackup,restoreEncryptedToEmptyDirectory}=require('./encrypted-backup.cjs');
const key='ab'.repeat(32),organizationId='org_001',branchId='branch_001';
test('authenticated encrypted backup restores stock and pending sale; tampering and wrong keys never publish plaintext',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-encrypted-'));
 const hub=createHub({port:0,dataDir:path.join(root,'data'),organizationId,branchId,token:'t'.repeat(40)});
 try{
  await hub.listen();const engine=createOfflineSalesEngine(hub.db,branchId);engine.setOpeningStock('sku',5,10);
  engine.commitSale({key:'encrypted-sale-001',lines:[{sku:'sku',quantity:2,priceMinor:100}]});
  const snapshot=path.join(root,'data','backups',hub.createLocalBackup().filename),encrypted=path.join(root,'backup.pbh');
  await encryptBackup({source:snapshot,destination:encrypted,key,organizationId,branchId});
  const content=fs.readFileSync(encrypted);assert.equal(content.includes(Buffer.from('SQLite format 3')),false);
  const args={backupPath:encrypted,dataDir:path.join(root,'restored'),organizationId,branchId,key};
  const restored=await restoreEncryptedToEmptyDirectory(args);assert.equal(restored.offlinePending,1);assert.equal(restored.offlineSales,1);
  await assert.rejects(restoreEncryptedToEmptyDirectory({...args,dataDir:path.join(root,'wrong'),key:'cd'.repeat(32)}));
  assert.equal(fs.existsSync(path.join(root,'wrong')),false);
  const tampered=path.join(root,'damaged.pbh');content[content.length-25]^=1;fs.writeFileSync(tampered,content);
  await assert.rejects(restoreEncryptedToEmptyDirectory({...args,backupPath:tampered,dataDir:path.join(root,'tampered')}));
  assert.equal(fs.existsSync(path.join(root,'tampered')),false);
  const target=path.join(root,'keep.txt');fs.writeFileSync(target,'do not remove');
  await assert.rejects(decryptBackup({source:encrypted,destination:target,key,organizationId,branchId}));
  assert.equal(fs.readFileSync(target,'utf8'),'do not remove');
 }finally{await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('backup policy retains verified history, coalesces concurrent runs and records mirror failure independently',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-backup-policy-')),dir=path.join(root,'data');
 const hub=createHub({port:0,dataDir:dir,organizationId,branchId,token:'a'.repeat(40)});
 let service;
 try{
  await hub.listen();const blockedMirror=path.join(root,'blocked');fs.writeFileSync(blockedMirror,'not a directory');
  service=createBackupService({db:hub.db,dir,organizationId,branchId,key,createSnapshot:hub.createLocalBackup,keep:2,mirrorDir:blockedMirror});
  const [a,b]=await Promise.all([service.run(),service.run()]);assert.equal(a.filename,b.filename);assert.equal(a.mirrorError,'BACKUP_MIRROR_FAILED');
  await service.run();await service.run();
  const files=fs.readdirSync(path.join(dir,'backups'));assert.equal(files.filter(x=>x.endsWith('.pbh')).length,2);assert.equal(files.some(x=>x.endsWith('.sqlite')),false);
  const failed=createBackupService({db:hub.db,dir,organizationId,branchId,key,createSnapshot:()=>{throw Error('injected IO error');}});
  await assert.rejects(failed.run(),/injected/);assert.equal(failed.status().error,'BACKUP_FAILED');await failed.stop();
  assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(x=>x.endsWith('.pbh')).length,2);
 }finally{if(service)await service.stop();await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('successful mirror has identical checksum; encrypted backup API remains administrator only',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-backup-api-')),dir=path.join(root,'data');
 const token='a'.repeat(40),hub=createHub({port:0,dataDir:dir,organizationId,branchId,token,backupKey:key,backupMirrorDir:path.join(root,'mirror')});
 try{
  const {port}=await hub.listen();
  const status=await fetch(`http://127.0.0.1:${port}/api/v1/backups`);assert.equal(status.status,401);
  const result=await fetch(`http://127.0.0.1:${port}/api/v1/backups`,{method:'POST',headers:{authorization:'Bearer '+token}});
  assert.equal(result.status,201);const saved=await result.json();assert.equal(saved.mirrorError,null);
  assert.deepEqual(fs.readFileSync(path.join(dir,'backups',saved.filename)),fs.readFileSync(path.join(root,'mirror',saved.filename)));
  const state=await fetch(`http://127.0.0.1:${port}/api/v1/backups`,{headers:{authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(state.encrypted,true);assert.equal(state.scheduled,true);
 }finally{await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a fresh requested checkpoint waits for an older in-flight snapshot and includes newly committed sales',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-fresh-backup-')),dir=path.join(root,'data');
 const hub=createHub({port:0,dataDir:dir,organizationId,branchId,token:'x'.repeat(40)});let service;
 try{
  await hub.listen();const engine=createOfflineSalesEngine(hub.db,branchId);engine.setOpeningStock('sku',5,10);
  service=createBackupService({db:hub.db,dir,organizationId,branchId,key,createSnapshot:hub.createLocalBackup});
  const older=service.run();
  engine.commitSale({key:'fresh-checkpoint-001',lines:[{sku:'sku',quantity:1,priceMinor:25}]});
  const fresh=service.run({fresh:true});
  const [a,b]=await Promise.all([older,fresh]);assert.notEqual(a.filename,b.filename);
  const restored=await restoreEncryptedToEmptyDirectory({backupPath:path.join(dir,'backups',b.filename),dataDir:path.join(root,'restored'),organizationId,branchId,key});
  assert.equal(restored.offlineSales,1);assert.equal(restored.offlinePending,1);
 }finally{if(service)await service.stop();await hub.close();fs.rmSync(root,{recursive:true,force:true});}
});
