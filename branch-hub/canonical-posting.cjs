'use strict';
const crypto=require('node:crypto');
const {PROJECT_REF,UUID}=require('./cloud-client.cjs');
const {invalidOfflineEvents}=require('./integrity.cjs');
const {createDeviceRegistry}=require('./devices.cjs');
const fingerprint=text=>crypto.createHash('sha256').update(text).digest('hex');
function createPostingStore(db,{organizationId,branchId,installationId}){
 db.exec(`CREATE TABLE IF NOT EXISTS cloud_posted_sales (
  event_id TEXT PRIMARY KEY REFERENCES offline_outbox(event_id),branch_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,canonical_sale_id TEXT NOT NULL UNIQUE,canonical_journal_id TEXT NOT NULL UNIQUE,
  total_minor INTEGER NOT NULL,cost_minor INTEGER NOT NULL,posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cloud_posting_errors (
  event_id TEXT PRIMARY KEY REFERENCES offline_outbox(event_id),branch_id TEXT NOT NULL,
  reason TEXT NOT NULL,checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 const {audit}=createDeviceRegistry(db,branchId);
 function verify(event,response){
  if(response?.projectRef!==PROJECT_REF||response.eventId!==event.event_id||response.organizationId!==organizationId||
   response.branchId!==branchId||response.payloadHash!==fingerprint(event.payload))throw Error('INVALID_CANONICAL_ACKNOWLEDGEMENT');
  const row=db.prepare('SELECT payload FROM offline_outbox WHERE branch_id=? AND event_id=?').get(branchId,event.event_id);
  if(!row||row.payload!==event.payload)throw Error('OUTBOX_CHANGED_DURING_POSTING');
  if(invalidOfflineEvents(db,branchId,event.event_id))throw Error('LOCAL_SALE_EVENT_CORRUPT');
 }
 function blocked(event,reason){
  const safe=/^HUB_[A-Z0-9_]{1,100}$/.test(reason||'')?reason:'HUB_CANONICAL_POSTING_BLOCKED';
  db.prepare(`INSERT INTO cloud_posting_errors(event_id,branch_id,reason) VALUES(?,?,?)
   ON CONFLICT(event_id) DO UPDATE SET reason=excluded.reason,checked_at=CURRENT_TIMESTAMP`).run(event.event_id,branchId,safe);
 }
 function accept(event,response){
  verify(event,response);
  if(response.stage==='conflict'){blocked(event,response.reason);return false;}
  const payload=JSON.parse(event.payload),cost=payload.lines.reduce((sum,line)=>sum+line.costMinor,0);
  if(response.stage!=='posted'||response.installationId!==installationId||!UUID.test(response.canonicalSaleId||'')||
   !UUID.test(response.canonicalJournalId||'')||!Number.isSafeInteger(cost)||response.costMinor!==cost||response.totalMinor!==payload.totalMinor)
   throw Error('INVALID_CANONICAL_ACKNOWLEDGEMENT');
  db.exec('BEGIN IMMEDIATE');
  try{
   const previous=db.prepare('SELECT * FROM cloud_posted_sales WHERE event_id=?').get(event.event_id);
   if(previous&&(previous.canonical_sale_id!==response.canonicalSaleId||previous.canonical_journal_id!==response.canonicalJournalId||previous.payload_hash!==response.payloadHash))throw Error('CANONICAL_ACKNOWLEDGEMENT_CONFLICT');
   if(!previous){
    db.prepare('INSERT INTO cloud_posted_sales(event_id,branch_id,payload_hash,canonical_sale_id,canonical_journal_id,total_minor,cost_minor) VALUES(?,?,?,?,?,?,?)')
     .run(event.event_id,branchId,response.payloadHash,response.canonicalSaleId,response.canonicalJournalId,payload.totalMinor,cost);
    db.prepare("UPDATE offline_outbox SET status='acknowledged' WHERE event_id=? AND branch_id=?").run(event.event_id,branchId);
    db.prepare('DELETE FROM cloud_posting_errors WHERE event_id=?').run(event.event_id);
    audit('cloud-sync','sale.canonical_posted',event.event_id,{canonicalSaleId:response.canonicalSaleId,canonicalJournalId:response.canonicalJournalId});
   }
   db.exec('COMMIT');return true;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function pending(){return db.prepare(`SELECT o.event_id,o.payload FROM offline_outbox o JOIN cloud_sale_receipts r ON r.event_id=o.event_id
  LEFT JOIN cloud_posted_sales p ON p.event_id=o.event_id WHERE o.branch_id=? AND o.status='pending' AND p.event_id IS NULL ORDER BY o.rowid LIMIT 100`).all(branchId);}
 return {accept,blocked,pending};
}
module.exports={createPostingStore};
