'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PROJECT_REF}=require('./cloud-client.cjs');
function createConfigVault(dir,storage,platform=process.platform){
 const file=path.join(dir,'branch-config.secure.json');
 function available(){
  if(!storage.isEncryptionAvailable() || platform==='linux'&&storage.getSelectedStorageBackend()==='basic_text')throw Error('OS_CREDENTIAL_VAULT_UNAVAILABLE');
 }
 function validate(config){
  if(!config||config.projectRef&&config.projectRef!==PROJECT_REF||
    !/^[a-zA-Z0-9_-]{3,80}$/.test(config.organizationId||'')||!/^[a-zA-Z0-9_-]{3,80}$/.test(config.branchId||'')||
    typeof config.token!=='string'||config.token.length<32)throw Error('INVALID_BRANCH_ENROLLMENT');
  return config;
 }
 function load(){
  available();
  if(!fs.existsSync(file))return null;
  const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
  if(envelope.version!==1||typeof envelope.ciphertext!=='string')throw Error('INVALID_CONFIG_VAULT');
  return validate(JSON.parse(storage.decryptString(Buffer.from(envelope.ciphertext,'base64'))));
 }
 function save(config){
  available();validate(config);
  const ciphertext=storage.encryptString(JSON.stringify(config));
  if(JSON.stringify(JSON.parse(storage.decryptString(ciphertext)))!==JSON.stringify(config))throw Error('VAULT_VERIFICATION_FAILED');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const temporary=path.join(dir,'.config-'+crypto.randomUUID());
  try{
   fs.writeFileSync(temporary,JSON.stringify({version:1,ciphertext:ciphertext.toString('base64')}),{flag:'wx',mode:0o600});
   const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.linkSync(temporary,file); // Never replace another enrollment, including a concurrent one.
  }finally{fs.rmSync(temporary,{force:true});}
 }
 function loadOrMigrate(){
  const current=load();if(current)return current;
  const legacy=path.join(dir,'branch-config.json');
  if(!fs.existsSync(legacy))return null;
  const config=validate(JSON.parse(fs.readFileSync(legacy,'utf8')));
  save(config);
  const verified=load();
  fs.unlinkSync(legacy);return verified;
 }
 return {load,save,loadOrMigrate,file};
}
module.exports={createConfigVault};
