'use strict';
const {createDeviceRegistry}=require('./devices.cjs');
const {validatePrinter}=require('./print-worker.cjs');
function createPrinterRegistry(db,branchId,initial={}){
 if(!initial||typeof initial!=='object'||Array.isArray(initial)||Object.keys(initial).length>100)throw Error('INVALID_PRINTER_CONFIGURATION');
 const seeds=Object.entries(initial).map(([id,value])=>[id,validatePrinter(id,value)]);
 db.exec('CREATE TABLE IF NOT EXISTS hub_printers(branch_id TEXT NOT NULL,id TEXT NOT NULL,config TEXT NOT NULL,PRIMARY KEY(branch_id,id))');
 const printers=Object.create(null),{audit}=createDeviceRegistry(db,branchId);
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const [id,value] of seeds)db.prepare('INSERT OR IGNORE INTO hub_printers(branch_id,id,config) VALUES(?,?,?)').run(branchId,id,JSON.stringify(value));
  for(const row of db.prepare('SELECT id,config FROM hub_printers WHERE branch_id=?').all(branchId))printers[row.id]=validatePrinter(row.id,JSON.parse(row.config));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 function configure(id,input,actor='administrator'){
  const value=validatePrinter(id,input),text=JSON.stringify(value);
  db.exec('BEGIN IMMEDIATE');
  try{
   const previous=db.prepare('SELECT config FROM hub_printers WHERE branch_id=? AND id=?').get(branchId,id);
   if(previous?.config===text){db.exec('COMMIT');return value;}
   if(!previous&&Object.keys(printers).length>=100)throw Error('PRINTER_LIMIT_REACHED');
   if(db.prepare(`SELECT 1 FROM jobs j LEFT JOIN print_dispatches d ON d.job_id=j.id
    WHERE j.branch_id=? AND json_extract(j.payload,'$.printerId')=? AND (j.status='pending' OR d.state IN ('queued','sending')) LIMIT 1`).get(branchId,id))throw Error('PRINTER_HAS_PENDING_JOBS');
   db.prepare('INSERT INTO hub_printers(branch_id,id,config) VALUES(?,?,?) ON CONFLICT(branch_id,id) DO UPDATE SET config=excluded.config').run(branchId,id,text);
   audit(actor,'printer.configure',id,{before:previous?JSON.parse(previous.config):null,after:value});db.exec('COMMIT');printers[id]=value;return value;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {printers,configure};
}
module.exports={createPrinterRegistry};
