'use strict';
const net=require('node:net');
const {createDeviceRegistry}=require('./devices.cjs');
function privateIPv4(host) {
 if(net.isIP(host)!==4)return false;
 const [a,b]=host.split('.').map(Number);
 return a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168) || a===127;
}
function encodeReceipt(payload) {
 // ASCII-only ESC/POS until a tested Arabic raster renderer is supplied.
 if(!payload || typeof payload.text!=='string' || payload.text.length<1 || payload.text.length>16000 ||
    /[^\x09\x0a\x20-\x7e]/.test(payload.text)) throw Error('UNSUPPORTED_RECEIPT_TEXT');
 return Buffer.concat([Buffer.from([27,64]),Buffer.from(payload.text+'\n\n\n','ascii'),Buffer.from([29,86,0])]);
}
function sendTcp(printer, bytes, timeoutMs=5000) {
 return new Promise((resolve,reject)=>{
  let attempted=false, settled=false;
  const socket=new net.Socket();
  const finish=(error)=>{
   if(settled)return;settled=true;socket.destroy();
   if(error){error.deliveryUncertain=attempted;reject(error);}else resolve();
  };
  socket.setTimeout(timeoutMs,()=>finish(Error('PRINTER_TIMEOUT')));
  socket.once('error',()=>finish(Error('PRINTER_CONNECTION_FAILED')));
  socket.once('close',()=>{if(!settled)finish(Error('PRINTER_CONNECTION_CLOSED'));});
  socket.connect(printer.port,printer.host,()=>{
   attempted=true;
   socket.end(bytes,()=>finish());
  });
 });
}
function createPrintWorker(db,branchId,printers={},transport=sendTcp) {
 for(const [id,p] of Object.entries(printers)) {
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||!privateIPv4(p.host)||!Number.isInteger(p.port)||p.port<1||p.port>65535)
   throw Error('INVALID_PRINTER_CONFIGURATION');
 }
 db.exec(`CREATE TABLE IF NOT EXISTS print_dispatches (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  state TEXT NOT NULL CHECK(state IN ('queued','sending','submitted','failed','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const {audit}=createDeviceRegistry(db,branchId);
 let active=null,stopped=false,timer;
 function claim() {
  db.exec('BEGIN IMMEDIATE');
  try {
   const job=db.prepare(`SELECT j.id,j.payload FROM jobs j LEFT JOIN print_dispatches d ON d.job_id=j.id
    WHERE j.branch_id=? AND j.status='pending' AND (d.job_id IS NULL OR d.state='queued') ORDER BY j.rowid LIMIT 1`).get(branchId);
   if(job) {
    db.prepare("INSERT OR IGNORE INTO print_dispatches(job_id,state) VALUES(?,'queued')").run(job.id);
    db.prepare("UPDATE print_dispatches SET state='sending',attempts=attempts+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?").run(job.id);
    audit('printer-worker','print.claim',job.id);
   }
   db.exec('COMMIT');return job;
  } catch(error){db.exec('ROLLBACK');throw error;}
 }
 async function dispatch() {
  const job=claim();if(!job)return false;
  let state='submitted',error=null;
  try {
   const payload=JSON.parse(job.payload),printer=printers[payload.printerId];
   if(!printer)throw Error('PRINTER_NOT_CONFIGURED');
   await transport(printer,encodeReceipt(payload));
  } catch(e) {state=e.deliveryUncertain?'uncertain':'failed';error=e.message;}
  db.exec('BEGIN IMMEDIATE');
  try {
   db.prepare('UPDATE print_dispatches SET state=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=?').run(state,error,job.id);
   db.prepare('UPDATE jobs SET status=? WHERE id=?').run(state==='submitted'?'done':'failed',job.id);
   audit('printer-worker','print.'+state,job.id,{error});
   db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}
  return true;
 }
 function processOnce() {
  if(stopped)return Promise.resolve(false);
  if(active)return active;
  active=dispatch().finally(()=>{active=null;});return active;
 }
 function retryFailed(id) {
  db.exec('BEGIN IMMEDIATE');
  try {
   const result=db.prepare(`UPDATE print_dispatches SET state='queued',error=NULL WHERE job_id=? AND state='failed'
    AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND branch_id=?)`).run(id,id,branchId);
   if(result.changes){db.prepare("UPDATE jobs SET status='pending' WHERE id=?").run(id);audit('administrator','print.retry',id);}
   db.exec('COMMIT');return result.changes===1;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {processOnce,retryFailed,
  start(){timer=setInterval(()=>processOnce().catch(()=>{}),1000);timer.unref();},
  async stop(){stopped=true;clearInterval(timer);if(active)await active;}};
}
module.exports={createPrintWorker,sendTcp,encodeReceipt};
