'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {encryptBackup,hashFile,decodeKey}=require('./encrypted-backup.cjs');
function createBackupService({db,dir,organizationId,branchId,key,createSnapshot,intervalMs=6*60*60*1000,keep=14,mirrorDir}){
 decodeKey(key).fill(0);
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000||!Number.isSafeInteger(keep)||keep<2||keep>1000)throw Error('INVALID_BACKUP_POLICY');
 db.exec(`CREATE TABLE IF NOT EXISTS backup_runs (
  id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,filename TEXT,sha256 TEXT,bytes INTEGER,
  error TEXT,mirror_error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 let timer,active=null,nextFresh=null,stopped=false;
 async function execute(){
  const id=crypto.randomUUID();let snapshot,file,result,mirrorError=null;
  try{
   snapshot=createSnapshot();const source=path.join(dir,'backups',snapshot.filename);
   file='encrypted-'+Date.now()+'-'+id+'.pbh';const destination=path.join(dir,'backups',file);
   result=await encryptBackup({source,destination,key,organizationId,branchId});
   fs.unlinkSync(source); // Only remove this run's plaintext after the authenticated archive is durable.
   if(mirrorDir){
    try{
     fs.mkdirSync(mirrorDir,{recursive:true,mode:0o700});
     const mirror=path.join(mirrorDir,file),temporary=mirror+'.partial-'+id;
     try{
      fs.copyFileSync(destination,temporary,fs.constants.COPYFILE_EXCL);fs.chmodSync(temporary,0o600);
      if(await hashFile(temporary)!==result.sha256)throw Error('MIRROR_CHECKSUM_MISMATCH');
      const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.linkSync(temporary,mirror);
     }finally{fs.rmSync(temporary,{force:true});}
    }catch{mirrorError='BACKUP_MIRROR_FAILED';}
   }
   db.prepare('INSERT INTO backup_runs(id,branch_id,filename,sha256,bytes,mirror_error) VALUES(?,?,?,?,?,?)').run(id,branchId,file,result.sha256,result.bytes,mirrorError);
   // Retention is based on successful runs in this branch's own ledger, never arbitrary directory files.
   const old=db.prepare('SELECT filename FROM backup_runs WHERE branch_id=? AND error IS NULL AND filename IS NOT NULL ORDER BY rowid DESC LIMIT -1 OFFSET ?').all(branchId,keep);
   for(const row of old){if(/^encrypted-[0-9]+-[0-9a-f-]+\.pbh$/.test(row.filename))fs.rmSync(path.join(dir,'backups',row.filename),{force:true});}
   return {filename:file,...result,mirrorError};
  }catch(error){
   db.prepare('INSERT INTO backup_runs(id,branch_id,error) VALUES(?,?,?)').run(id,branchId,'BACKUP_FAILED');
   throw error;
  }
 }
 function run({fresh=false}={}){if(stopped)return Promise.reject(Error('BACKUP_SERVICE_STOPPED'));if(active){if(!fresh)return active;if(!nextFresh)nextFresh=active.catch(()=>{}).then(()=>{nextFresh=null;return run();});return nextFresh;}active=execute().finally(()=>{active=null;});return active;}
 return {run,status(){return db.prepare('SELECT filename,sha256,bytes,error,mirror_error,created_at FROM backup_runs WHERE branch_id=? ORDER BY rowid DESC LIMIT 1').get(branchId)||null;},
  start(){queueMicrotask(()=>{if(!stopped)run().catch(()=>{});});timer=setInterval(()=>run().catch(()=>{}),intervalMs);timer.unref();},
  async stop(){stopped=true;clearInterval(timer);if(active)await active.catch(()=>{});if(nextFresh)await nextFresh.catch(()=>{});}};
}
module.exports={createBackupService};
