'use strict';
// Fail-closed signed Windows update staging. Installing/rolling back is a separate OS lifecycle step.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {pipeline}=require('node:stream/promises');
const {Transform,Readable}=require('node:stream');
const {hashFile}=require('./encrypted-backup.cjs');
const {PROJECT_REF}=require('./cloud-client.cjs');
function version(value){if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value))throw Error('INVALID_UPDATE_VERSION');return value.split('.').map(Number);}
function newer(next,current){const a=version(next),b=version(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
function verifyManifest({manifestText,signature,publicKey,currentVersion,databaseVersion,now=Date.now()}){
 if(typeof manifestText!=='string'||Buffer.byteLength(manifestText)>16384||typeof signature!=='string')throw Error('INVALID_UPDATE_MANIFEST');
 const key=crypto.createPublicKey(publicKey);if(key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,Buffer.from(manifestText),key,Buffer.from(signature,'base64')))throw Error('UPDATE_SIGNATURE_INVALID');
 const manifest=JSON.parse(manifestText);
 if(manifest.appId!=='com.premieros.branchhub'||manifest.projectRef!==PROJECT_REF||manifest.repository!=='Premieros/.com'||manifest.platform!=='win32-x64')throw Error('UPDATE_SCOPE_MISMATCH');
 if(!newer(manifest.version,currentVersion))throw Error('UPDATE_DOWNGRADE_BLOCKED');
 if(!Number.isSafeInteger(databaseVersion)||!Number.isSafeInteger(manifest.minDatabaseVersion)||!Number.isSafeInteger(manifest.maxDatabaseVersion)||
   databaseVersion<manifest.minDatabaseVersion||databaseVersion>manifest.maxDatabaseVersion)throw Error('UPDATE_SCHEMA_INCOMPATIBLE');
 if(!Number.isSafeInteger(manifest.bytes)||manifest.bytes<64||manifest.bytes>512*1024*1024||!/^[0-9a-f]{64}$/.test(manifest.sha256||''))throw Error('INVALID_UPDATE_ARTIFACT');
 const issued=Date.parse(manifest.issuedAt),expires=Date.parse(manifest.expiresAt);
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+5*60*1000||expires<=now||expires<=issued)throw Error('UPDATE_MANIFEST_EXPIRED');
 const url=new URL(manifest.url);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname!=='github.com'||!/^\/Premieros\/\.com\/releases\/download\/[^/]+\/[^/]+\.exe$/.test(url.pathname))throw Error('UPDATE_SOURCE_REJECTED');
 return manifest;
}
async function download(url,fetchImpl){
 let next=url;
 for(let redirects=0;redirects<5;redirects++){
  const target=new URL(next);
  if(target.protocol!=='https:'||target.username||target.password||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname))throw Error('UPDATE_REDIRECT_REJECTED');
  const response=await fetchImpl(next,{redirect:'manual',signal:AbortSignal.timeout(120000),cache:'no-store'});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('UPDATE_DOWNLOAD_FAILED');next=new URL(location,next).href;continue;}
  if(!response.ok||!response.body)throw Error('UPDATE_DOWNLOAD_FAILED');return response;
 }
 throw Error('UPDATE_REDIRECT_LIMIT');
}
async function stageUpdate({manifestText,signature,publicKey,currentVersion,databaseVersion,dir,createRecoveryBackup,fetchImpl=fetch,now}){
 const manifest=verifyManifest({manifestText,signature,publicKey,currentVersion,databaseVersion,now});
 if(typeof createRecoveryBackup!=='function')throw Error('UPDATE_RECOVERY_BACKUP_REQUIRED');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const target=path.join(dir,'update-'+manifest.version+'.exe'),temporary=target+'.'+crypto.randomUUID()+'.partial';
 let published=false;
 try{
  const response=await download(manifest.url,fetchImpl);let count=0;
  const limit=new Transform({transform(chunk,encoding,callback){count+=chunk.length;callback(count>manifest.bytes?Error('UPDATE_SIZE_MISMATCH'):null,chunk);}});
  const source=response.body.getReader?Readable.fromWeb(response.body):response.body;
  await pipeline(source,limit,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
  if(count!==manifest.bytes||await hashFile(temporary)!==manifest.sha256)throw Error('UPDATE_CHECKSUM_MISMATCH');
  const fd=fs.openSync(temporary,'r+');try{const header=Buffer.alloc(2);fs.readSync(fd,header,0,2,0);if(header.toString()!=='MZ')throw Error('UPDATE_NOT_WINDOWS_EXECUTABLE');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const recovery=await createRecoveryBackup();
  if(!recovery||!recovery.filename?.endsWith('.pbh')||!recovery.sha256)throw Error('UPDATE_RECOVERY_BACKUP_UNVERIFIED');
  fs.linkSync(temporary,target);published=true;
  const record={version:manifest.version,previousVersion:currentVersion,installer:path.basename(target),sha256:manifest.sha256,
   backup:recovery.filename,backupSha256:recovery.sha256,phase:'staged',automaticInstallImplemented:false};
  const recordFile=target+'.json';fs.writeFileSync(recordFile,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  return record;
 }catch(error){if(published)fs.rmSync(target,{force:true});throw error;}
 finally{fs.rmSync(temporary,{force:true});}
}
module.exports={verifyManifest,stageUpdate};
