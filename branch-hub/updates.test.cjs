'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {verifyManifest,stageUpdate}=require('./updates.cjs');
const {PROJECT_REF}=require('./cloud-client.cjs');
function release(overrides={}){
 const pair=crypto.generateKeyPairSync('ed25519'),bytes=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(126)]);
 const manifest={appId:'com.premieros.branchhub',repository:'Premieros/.com',projectRef:PROJECT_REF,platform:'win32-x64',version:'0.2.0',
  minDatabaseVersion:1,maxDatabaseVersion:3,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  url:'https://github.com/Premieros/.com/releases/download/v0.2.0/BranchHub.exe',issuedAt:'2026-10-28T00:00:00Z',expiresAt:'2026-11-28T00:00:00Z',...overrides};
 const manifestText=JSON.stringify(manifest),signature=crypto.sign(null,Buffer.from(manifestText),pair.privateKey).toString('base64');
 return {manifestText,signature,publicKey:pair.publicKey.export({type:'spki',format:'pem'}),bytes,currentVersion:'0.1.0',databaseVersion:3,now:Date.parse('2026-10-28T12:00:00Z')};
}
test('signed update rejects tampering, wrong project, downgrade, expiry and incompatible data schema',()=>{
 const good=release();assert.equal(verifyManifest(good).version,'0.2.0');
 assert.throws(()=>verifyManifest({...good,manifestText:good.manifestText.replace('0.2.0','9.9.9')}),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyManifest(release({projectRef:'wrong-project'})),/SCOPE_MISMATCH/);
 assert.throws(()=>verifyManifest(release({version:'0.0.9'})),/DOWNGRADE_BLOCKED/);
 assert.throws(()=>verifyManifest(release({maxDatabaseVersion:2})),/SCHEMA_INCOMPATIBLE/);
 assert.throws(()=>verifyManifest(release({expiresAt:'2026-10-27T00:00:00Z'})),/EXPIRED/);
 assert.throws(()=>verifyManifest(release({url:'https://example.test/evil.exe'})),/SOURCE_REJECTED/);
});
test('update is staged only after checksum and encrypted recovery checkpoint; tampering leaves no executable',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-update-'));
 try{
  const good=release();let backups=0;
  const options={...good,dir,createRecoveryBackup:async()=>{backups++;return {filename:'encrypted-checkpoint.pbh',sha256:'a'.repeat(64)};},fetchImpl:async()=>({ok:true,status:200,body:Readable.from(good.bytes)})};
  const result=await stageUpdate(options);assert.equal(result.phase,'staged');assert.equal(backups,1);assert.equal(result.automaticInstallImplemented,false);
  const bad=release({version:'0.3.0'});
  await assert.rejects(stageUpdate({...options,...bad,fetchImpl:async()=>({ok:true,status:200,body:Readable.from(Buffer.alloc(128))})}),/CHECKSUM_MISMATCH/);
  assert.equal(fs.existsSync(path.join(dir,'update-0.3.0.exe')),false);assert.equal(backups,1);
  await assert.rejects(stageUpdate({...options,...release({version:'0.4.0'}),createRecoveryBackup:async()=>{throw Error('BACKUP_FAILED');}}),/BACKUP_FAILED/);
  assert.equal(fs.existsSync(path.join(dir,'update-0.4.0.exe')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
