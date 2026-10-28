'use strict';
const crypto=require('node:crypto');
const {PROJECT_REF,UUID}=require('./cloud-client.cjs');
const {createDeviceRegistry}=require('./devices.cjs');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function createSyncStore(db,{organizationId,branchId,installationId}){
 db.exec(`CREATE TABLE IF NOT EXISTS cloud_sale_receipts (
  event_id TEXT PRIMARY KEY REFERENCES offline_outbox(event_id),branch_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage='received'),received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cloud_price_inbox (
  id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale','conflict')),reason TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS offline_catalog (
  branch_id TEXT NOT NULL,sku TEXT NOT NULL,revision INTEGER NOT NULL,
  sale_price_minor INTEGER NOT NULL,unit_cost_minor INTEGER NOT NULL,PRIMARY KEY(branch_id,sku));`);
 const {audit}=createDeviceRegistry(db,branchId);
 function acceptReceipt(event,receipt){
  if(receipt?.projectRef!==PROJECT_REF||receipt.organizationId!==organizationId||receipt.branchId!==branchId||
   receipt.eventId!==event.event_id||receipt.payloadHash!==hash(event.payload)||receipt.stage!=='received')throw Error('INVALID_CLOUD_ACKNOWLEDGEMENT');
  const current=db.prepare("SELECT payload FROM offline_outbox WHERE event_id=? AND branch_id=? AND status='pending'").get(event.event_id,branchId);
  if(!current||current.payload!==event.payload)throw Error('OUTBOX_CHANGED_DURING_SYNC');
  db.prepare("INSERT INTO cloud_sale_receipts(event_id,branch_id,payload_hash,stage) VALUES(?,?,?,'received') ON CONFLICT(event_id) DO NOTHING").run(event.event_id,branchId,receipt.payloadHash);
  // Transport receipt does not acknowledge or delete financial outbox records.
 }
 function applyPrice(command,{retryConflict=false,actor='cloud-sync'}={}){
  if(!command||!UUID.test(command.id||'')||command.organization_id!==organizationId||command.branch_id!==branchId||
   !/^[a-zA-Z0-9_.-]{1,80}$/.test(command.sku||'')||!Number.isSafeInteger(command.revision)||command.revision<1||
   !Number.isSafeInteger(command.sale_price_minor)||command.sale_price_minor<0||!Number.isSafeInteger(command.unit_cost_minor)||command.unit_cost_minor<0)throw Error('INVALID_CLOUD_COMMAND');
  const text=JSON.stringify({id:command.id,organization_id:command.organization_id,branch_id:command.branch_id,sku:command.sku,
   revision:command.revision,sale_price_minor:command.sale_price_minor,unit_cost_minor:command.unit_cost_minor});
  const fingerprint=hash(text);
  db.exec('SAVEPOINT hub_price_command');
  try{
   const previous=db.prepare('SELECT payload_hash,outcome FROM cloud_price_inbox WHERE id=?').get(command.id);
   if(previous){if(previous.payload_hash!==fingerprint)throw Error('INBOX_IDEMPOTENCY_CONFLICT');if(!(retryConflict&&previous.outcome==='conflict')){db.exec('RELEASE hub_price_command');return previous.outcome;}}
   const stock=db.prepare('SELECT quantity FROM offline_stock WHERE branch_id=? AND sku=?').get(branchId,command.sku);
   const current=db.prepare('SELECT * FROM offline_catalog WHERE branch_id=? AND sku=?').get(branchId,command.sku);
   let outcome='applied',reason=null;
   if(!stock){outcome='conflict';reason='UNKNOWN_LOCAL_SKU';}
   else if(current&&current.revision>command.revision){outcome='stale';reason='OLDER_REVISION';}
   else if(current&&current.revision===command.revision){
    outcome=current.sale_price_minor===command.sale_price_minor&&current.unit_cost_minor===command.unit_cost_minor?'stale':'conflict';reason='REVISION_ALREADY_USED';
   }
   if(outcome==='applied'){
    db.prepare(`INSERT INTO offline_catalog(branch_id,sku,revision,sale_price_minor,unit_cost_minor) VALUES(?,?,?,?,?)
     ON CONFLICT(branch_id,sku) DO UPDATE SET revision=excluded.revision,sale_price_minor=excluded.sale_price_minor,unit_cost_minor=excluded.unit_cost_minor`)
     .run(branchId,command.sku,command.revision,command.sale_price_minor,command.unit_cost_minor);
    db.prepare('UPDATE offline_stock SET unit_cost_minor=? WHERE branch_id=? AND sku=?').run(command.unit_cost_minor,branchId,command.sku);
   }
   db.prepare('INSERT INTO cloud_price_inbox(id,branch_id,payload_hash,payload,outcome,reason) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome,reason=excluded.reason').run(command.id,branchId,fingerprint,text,outcome,reason);
   audit(actor,'price.'+outcome,command.id,{sku:command.sku,revision:command.revision,reason});
   db.exec('RELEASE hub_price_command');return outcome;
  }catch(error){db.exec('ROLLBACK TO hub_price_command; RELEASE hub_price_command');throw error;}
 }
 function pending(){return db.prepare(`SELECT o.event_id,o.payload FROM offline_outbox o LEFT JOIN cloud_sale_receipts r ON r.event_id=o.event_id
  WHERE o.branch_id=? AND o.status='pending' AND r.event_id IS NULL ORDER BY o.rowid LIMIT 100`).all(branchId);}
 return {acceptReceipt,applyPrice,pending,retryConflict(id,actor){const row=db.prepare("SELECT payload FROM cloud_price_inbox WHERE id=? AND branch_id=? AND outcome='conflict'").get(id,branchId);if(!row)throw Error('PRICE_CONFLICT_NOT_FOUND');return applyPrice(JSON.parse(row.payload),{retryConflict:true,actor});},scope:{organizationId,branchId,installationId}};
}
function createCloudSync({db,client,organizationId,branchId,installationId,refreshToken,persistRefreshToken,clock=Date.now}){
 if(![organizationId,branchId,installationId].every(x=>UUID.test(x||''))||typeof persistRefreshToken!=='function')throw Error('CLOUD_ENROLLMENT_REQUIRED');
 const store=createSyncStore(db,{organizationId,branchId,installationId});
 let session=null,active=null,stopped=false,timer,failures=0,lastError=null;
 async function access(){
  if(session&&session.until>clock())return session.token;
  const result=await client.request('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:refreshToken}});
  if(typeof result?.access_token!=='string'||typeof result.refresh_token!=='string'||!Number.isFinite(result.expires_in))throw Error('INVALID_CLOUD_SESSION');
  await client.validateEnrollment(result.access_token,branchId);
  await persistRefreshToken(result.refresh_token);refreshToken=result.refresh_token;
  session={token:result.access_token,until:clock()+Math.max(0,result.expires_in-60)*1000};return session.token;
 }
 async function synchronize(){
  const accessToken=await access();
  for(const event of store.pending()){
   const receipt=await client.request('/rest/v1/rpc/receive_branch_hub_sale_v1',{accessToken,body:{p_organization_id:organizationId,p_branch_id:branchId,p_installation_id:installationId,p_event_id:event.event_id,p_payload_text:event.payload}});
   store.acceptReceipt(event,receipt);
  }
  const commands=await client.request('/rest/v1/rpc/pull_branch_hub_prices_v1',{accessToken,body:{p_organization_id:organizationId,p_branch_id:branchId,p_installation_id:installationId}});
  if(!Array.isArray(commands)||commands.length>100)throw Error('INVALID_CLOUD_INBOX');
  for(const command of commands){
   store.applyPrice(command);
   // ACK only after the command, outcome and audit have committed locally. No cursor can skip uncommitted cloud rows.
   await client.request('/rest/v1/branch_hub_command_receipts?on_conflict=installation_id,command_id',{accessToken,body:{installation_id:installationId,command_id:command.id},prefer:'resolution=ignore-duplicates,return=minimal'});
  }
  failures=0;lastError=null;
  return status();
 }
 function status(){return {configured:true,replicatedSales:db.prepare('SELECT count(*) n FROM cloud_sale_receipts WHERE branch_id=?').get(branchId).n,
  priceConflicts:db.prepare("SELECT count(*) n FROM cloud_price_inbox WHERE branch_id=? AND outcome='conflict'").get(branchId).n,lastError,canonicalPostingImplemented:false};}
 function run(){
  if(stopped)return Promise.reject(Error('SYNC_STOPPED'));if(active)return active;
  active=synchronize().catch(error=>{session=null;failures++;lastError=error.message;throw error;}).finally(()=>{active=null;});return active;
 }
 function schedule(delay){timer=setTimeout(async()=>{try{await run();}catch{}if(!stopped)schedule(Math.min(15*60*1000,30000*2**Math.min(failures,5)));},delay);timer.unref();}
 return {run,status,start(){schedule(5000);},async stop(){stopped=true;clearTimeout(timer);if(active)await active.catch(()=>{});}};
}
module.exports={createSyncStore,createCloudSync,hash};
