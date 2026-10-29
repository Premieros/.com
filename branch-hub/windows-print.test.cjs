'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {validatePrinter,createPrintWorker}=require('./print-worker.cjs');
const {createHub}=require('./server.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Windows spooler destination accepts exact installed names without a shell and rejects control characters',()=>{
 assert.deepEqual(validatePrinter('cashier',{kind:'windows',name:'XP-80C'}),{kind:'windows',name:'XP-80C',format:'raster',dots:576});
 for(const name of ['', 'XP-80C\nother', '\0', 'a'.repeat(257)])assert.throws(()=>validatePrinter('cashier',{kind:'windows',name}),/INVALID_PRINTER/);
 assert.throws(()=>validatePrinter('bad/id',{kind:'windows',name:'XP-80C'}),/INVALID_PRINTER/);
});
test('Windows queue claims once and blocks retry after uncertain spooler submission',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE jobs(id TEXT PRIMARY KEY,branch_id TEXT,kind TEXT,status TEXT,payload TEXT)");
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run('job-1','branch-1','print','pending',JSON.stringify({printerId:'cashier',text:'TEST RECEIPT'}));
 let calls=0;
 const worker=createPrintWorker(db,'branch-1',{cashier:validatePrinter('cashier',{kind:'windows',name:'XP-80C',format:'text'})},async()=>{throw Error('TCP must not be used');},{windowsTransport:async()=>{calls++;const e=Error('SPOOLER_ACK_LOST');e.deliveryUncertain=true;throw e;}});
 try{await Promise.all([worker.processOnce(),worker.processOnce()]);assert.equal(calls,1);assert.equal(db.prepare('SELECT state FROM print_dispatches').get().state,'uncertain');assert.equal(worker.retryFailed('job-1'),false);await worker.processOnce();assert.equal(calls,1);}
 finally{await worker.stop();db.close();}
});
test('confirmed Windows spooler job identity is audited without claiming that paper was printed',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,branch_id TEXT,kind TEXT,status TEXT,payload TEXT)');
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run('job-2','branch-1','print','pending',JSON.stringify({printerId:'cashier',text:'TEST'}));
 const worker=createPrintWorker(db,'branch-1',{cashier:validatePrinter('cashier',{kind:'windows',name:'XP-80C',format:'text'})},undefined,{windowsTransport:async()=>({jobId:123,submitted:true,paperConfirmed:false})});
 try{await worker.processOnce();assert.equal(db.prepare('SELECT state FROM print_dispatches').get().state,'submitted');const details=JSON.parse(db.prepare("SELECT details FROM hub_audit WHERE action='print.submitted'").get().details);assert.equal(details.target.spoolJobId,123);assert.equal(details.target.paperConfirmed,false);}
 finally{await worker.stop();db.close();}
});
test('Windows printer discovery is administrator-only and printer destination survives server restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premier-windows-printer-'));
 const config={host:'127.0.0.1',port:0,dataDir:dir,branchId:'branch-1',organizationId:'org-1',token:'synthetic-admin-token-at-least-32-characters',enumerateWindowsPrinters:async()=>({printers:['XP-80C']})};
 let hub=createHub(config);
 try{
  let {port}=await hub.listen();let base='http://127.0.0.1:'+port;
  const headers={authorization:'Bearer '+config.token,'content-type':'application/json'};
  assert.equal((await fetch(base+'/api/v1/printers/windows')).status,401);
  assert.deepEqual(await (await fetch(base+'/api/v1/printers/windows',{headers})).json(),{printers:['XP-80C']});
  const pairedResponse=await fetch(base+'/api/v1/devices',{method:'POST',headers,body:JSON.stringify({organizationId:config.organizationId,branchId:config.branchId,name:'viewer',role:'viewer'})});assert.equal(pairedResponse.status,201);const paired=await pairedResponse.json();
  assert.equal((await fetch(base+'/api/v1/printers/windows',{headers:{authorization:'Bearer '+paired.token}})).status,403);
  assert.equal((await fetch(base+'/api/v1/printers/cashier',{method:'PUT',headers,body:JSON.stringify({organizationId:config.organizationId,branchId:config.branchId,kind:'windows',name:'XP-80C'})})).status,200);
  await hub.close();hub=createHub(config);({port}=await hub.listen());base='http://127.0.0.1:'+port;
  const stored=await (await fetch(base+'/api/v1/printers',{headers})).json();assert.equal(stored.details.cashier.name,'XP-80C');assert.equal(stored.details.cashier.kind,'windows');
 }finally{await hub.close();fs.rmSync(dir,{recursive:true,force:true});}
});
