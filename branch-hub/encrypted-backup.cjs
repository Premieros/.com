'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const MAGIC=Buffer.from('PBHBK001');
function decodeKey(value){
 if(typeof value!=='string'||!/^[0-9a-f]{64}$/i.test(value))throw Error('BACKUP_KEY_REQUIRED');
 return Buffer.from(value,'hex');
}
async function hashFile(file){
 const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
async function encryptBackup({source,destination,key,organizationId,branchId}){
 const bytes=decodeKey(key),iv=crypto.randomBytes(12);
 const metadata=Buffer.from(JSON.stringify({version:1,organizationId,branchId,iv:iv.toString('hex')}));
 if(metadata.length>8192)throw Error('BACKUP_METADATA_TOO_LARGE');
 const size=Buffer.alloc(4);size.writeUInt32BE(metadata.length);
 const header=Buffer.concat([MAGIC,size,metadata]);
 const temporary=destination+'.'+crypto.randomUUID()+'.partial';
 try{
  fs.writeFileSync(temporary,header,{flag:'wx',mode:0o600});
  const cipher=crypto.createCipheriv('aes-256-gcm',bytes,iv);cipher.setAAD(header);
  await pipeline(fs.createReadStream(source),cipher,fs.createWriteStream(temporary,{flags:'a',mode:0o600}));
  fs.appendFileSync(temporary,cipher.getAuthTag());
  const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.linkSync(temporary,destination);
  return {sha256:await hashFile(destination),bytes:fs.statSync(destination).size};
 }finally{bytes.fill(0);fs.rmSync(temporary,{force:true});}
}
async function decryptBackup({source,destination,key,organizationId,branchId}){
 const bytes=decodeKey(key),fd=fs.openSync(source,'r');
 const temporary=destination+'.'+crypto.randomUUID()+'.unverified';
 let metadata,header,offset,total;
 try{
  total=fs.fstatSync(fd).size;
  const prefix=Buffer.alloc(12);if(fs.readSync(fd,prefix,0,12,0)!==12||!prefix.subarray(0,8).equals(MAGIC))throw Error('INVALID_ENCRYPTED_BACKUP');
  const length=prefix.readUInt32BE(8);if(length>8192||total<12+length+16)throw Error('INVALID_ENCRYPTED_BACKUP');
  const content=Buffer.alloc(length);if(fs.readSync(fd,content,0,length,12)!==length)throw Error('INVALID_ENCRYPTED_BACKUP');
  metadata=JSON.parse(content.toString());header=Buffer.concat([prefix,content]);offset=header.length;
  if(metadata.version!==1||!/^[0-9a-f]{24}$/.test(metadata.iv||''))throw Error('INVALID_ENCRYPTED_BACKUP');
  if(metadata.organizationId!==organizationId||metadata.branchId!==branchId)throw Error('BACKUP_BRANCH_BINDING_MISMATCH');
  const tag=Buffer.alloc(16);fs.readSync(fd,tag,0,16,total-16);
  const decipher=crypto.createDecipheriv('aes-256-gcm',bytes,Buffer.from(metadata.iv,'hex'));decipher.setAAD(header);decipher.setAuthTag(tag);
  // The unverified plaintext is private staging only. Never publish it before authentication succeeds.
  await pipeline(fs.createReadStream(source,{fd,autoClose:false,start:offset,end:total-17}),decipher,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
  const output=fs.openSync(temporary,'r+');try{fs.fsyncSync(output);}finally{fs.closeSync(output);}
  fs.linkSync(temporary,destination);
 }finally{bytes.fill(0);fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
async function restoreEncryptedToEmptyDirectory({backupPath,dataDir,organizationId,branchId,key}){
 const {restoreToEmptyDirectory}=require('./restore.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hub-recovery-'));fs.chmodSync(root,0o700);
 const plaintext=path.join(root,'snapshot.sqlite');
 try{
  await decryptBackup({source:backupPath,destination:plaintext,key,organizationId,branchId});
  return restoreToEmptyDirectory({backupPath:plaintext,dataDir,organizationId,branchId});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={encryptBackup,decryptBackup,restoreEncryptedToEmptyDirectory,hashFile,decodeKey};
