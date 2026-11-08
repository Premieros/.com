'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {verifyManifest,stageUiRelease,validateManifest}=require('./uiReleaseStore.cjs');

async function fixture(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-signed-ui-'));
  const source=path.join(dir,'source'),store=path.join(dir,'store');
  fs.mkdirSync(path.join(source,'assets'),{recursive:true});
  fs.writeFileSync(path.join(source,'index.html'),'<html><body>Premier</body></html>');
  fs.writeFileSync(path.join(source,'assets','app.js'),'window.PREMIER_TEST=true;');
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
  const files=['index.html','assets/app.js'].map(filename=>{
    const buffer=fs.readFileSync(path.join(source,filename));
    return {path:filename,size:buffer.length,
      sha256:crypto.createHash('sha256').update(buffer).digest('hex')};
  });
  const manifest={format:1,releaseId:'ui-test-20261108',files};
  const sign=(value)=>{
    const manifestText=JSON.stringify(value);
    return {manifestText,
      signatureBase64:crypto.sign(null,Buffer.from(manifestText),privateKey).toString('base64'),
      publicKeyPem};
  };
  try {await fn({source,store,manifest,sign,publicKeyPem});}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('signed full UI can be staged without activation or touching local data',async()=>{
  await fixture(async({source,store,manifest,sign})=>{
    const signed=sign(manifest);
    assert.equal(verifyManifest(signed).releaseId,manifest.releaseId);
    const result=await stageUiRelease({sourceDir:source,storeDir:store,...signed});
    assert.deepEqual(result,{releaseId:manifest.releaseId,staged:true,activated:false});
    assert.equal(fs.readFileSync(path.join(store,manifest.releaseId,'index.html'),'utf8'),
      fs.readFileSync(path.join(source,'index.html'),'utf8'));
    assert.equal(fs.existsSync(path.join(store,'active.json')),false);
    await assert.rejects(stageUiRelease({sourceDir:source,storeDir:store,...signed}),
      /UI_RELEASE_ALREADY_STAGED/);
  });
});
test('rejects unsigned, changed, or wrongly signed manifests',async()=>{
  await fixture(async({manifest,sign,publicKeyPem})=>{
    const signed=sign(manifest);
    assert.throws(()=>verifyManifest({...signed,signatureBase64:'AA=='}),
      /UI_RELEASE_SIGNATURE_INVALID/);
    assert.throws(()=>verifyManifest({...signed,manifestText:JSON.stringify({...manifest,releaseId:'changed'})}),
      /UI_RELEASE_SIGNATURE_INVALID/);
    const other=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
    assert.throws(()=>verifyManifest({...signed,publicKeyPem:other}),
      /UI_RELEASE_SIGNATURE_INVALID/);
    assert.ok(publicKeyPem);
  });
});
test('rejects path traversal, case collisions, invalid extension, and missing index',async()=>{
  await fixture(async({manifest})=>{
    const base=manifest.files[0];
    for (const p of ['../secrets.json','/app.js','assets\\evil.js','a//b.js','assets/malware.exe']) {
      assert.throws(()=>validateManifest({...manifest,files:[{...base,path:p}]}));
    }
    assert.throws(()=>validateManifest({...manifest,files:[
      {...base,path:'index.html'},{...base,path:'INDEX.HTML'}]}),/UI_RELEASE_FILE_INVALID/);
    assert.throws(()=>validateManifest({...manifest,files:[{...base,path:'app.js'}]}),
      /UI_RELEASE_INDEX_REQUIRED/);
  });
});
test('rejects tampered staged asset without leaving an active release',async()=>{
  await fixture(async({source,store,manifest,sign})=>{
    const signed=sign(manifest);
    fs.writeFileSync(path.join(source,'assets','app.js'),'tampered');
    await assert.rejects(stageUiRelease({sourceDir:source,storeDir:store,...signed}),
      /UI_RELEASE_FILE_INVALID|UI_RELEASE_HASH_MISMATCH/);
    assert.equal(fs.existsSync(path.join(store,manifest.releaseId)),false);
  });
});
test('rejects symlinked assets even when they point within the source',async(t)=>{
  await fixture(async({source,store,manifest,sign})=>{
    const filename=path.join(source,'assets','app.js');
    fs.renameSync(filename,filename+'.real');
    try {fs.symlinkSync(filename+'.real',filename);}
    catch(error) {
      if (['EPERM','EACCES'].includes(error.code)) {t.skip('Windows symlink privilege unavailable');return;}
      throw error;
    }
    await assert.rejects(stageUiRelease({sourceDir:source,storeDir:store,...sign(manifest)}),
      /UI_RELEASE_FILE_INVALID/);
  });
});
