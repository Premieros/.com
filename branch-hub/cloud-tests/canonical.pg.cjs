'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const org='11111111-1111-4111-8111-111111111111',branch='22222222-2222-4222-8222-222222222222',warehouse='55555555-5555-4555-8555-555555555555',product='66666666-6666-4666-8666-666666666666',installation='44444444-4444-4444-8444-444444444444';
async function main(){
 const client=new Client({connectionString:process.env.HUB_TEST_DATABASE_URL});await client.connect();
 const file=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
 async function asUser(fn,settings={}){
  await client.query('BEGIN');
  try{
   await client.query("SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='33333333-3333-4333-8333-333333333333'");
   for(const [key,value] of Object.entries({'hub_test.admin':'true','hub_test.branch':branch,'hub_test.tax':'false','hub_test.fail_after_stock':'false',...settings}))await client.query('SELECT set_config($1,$2,true)',[key,value]);
   const result=await fn();await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}
 }
 const makeEvent=()=>{const id=crypto.randomUUID();return {id,text:JSON.stringify({saleId:id,branchId:branch,key:'canonical-'+id,totalMinor:500,paymentAccount:'cash',lines:[{sku:`p_${product}_${warehouse}`,quantity:2,priceMinor:250,costMinor:200,canonical:{productId:product,warehouseId:warehouse,unitName:'piece'}}]})};};
 const receive=e=>asUser(()=>client.query('SELECT public.receive_branch_hub_sale_v1($1,$2,$3,$4,$5)',[org,branch,installation,e.id,e.text]));
 const post=(e,settings={})=>asUser(()=>client.query('SELECT public.post_branch_hub_sale_v1($1,$2,$3,$4) result',[org,branch,installation,e.id]),settings).then(r=>r.rows[0].result);
 const counts=async()=> (await client.query(`SELECT (SELECT count(*)::int FROM sales) sales,(SELECT sum(quantity)::float8 FROM inventory_batches) stock,(SELECT count(*)::int FROM journal_entries) journals,(SELECT count(*)::int FROM branch_hub_posted_sales) posts,(SELECT count(*)::int FROM private.pos_sale_idempotency) dedup`)).rows[0];
 try{
  const manifest=JSON.parse(file('canonical/source-manifest.json'));assert.equal(manifest.projectRef,'hvqlkapynjfjikqithvd');assert.equal(crypto.createHash('sha256').update(file('canonical/source.sql')).digest('hex'),manifest.sha256);
  await client.query(file('fixtures.sql'));await client.query(file('canonical/fixtures.sql'));await client.query(file('canonical/source.sql'));
  for(const name of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await client.query(file('../supabase/migrations/'+name));
  const catalog=(await asUser(()=>client.query('SELECT public.get_branch_hub_catalog_v1($1,$2,$3) snapshot',[org,branch,warehouse]))).rows[0].snapshot;
  assert.equal(catalog.products.length,1);assert.equal(catalog.products[0].quantity,20);assert.equal(catalog.products[0].priceCommand.unit_cost_minor,100); // current price, not batch cost 10
  const event=makeEvent();await receive(event);
  const first=await post(event);
  if(first.stage!=='posted')await asUser(async()=>{
   const diagnostic=await client.query("SELECT public.process_sale_idempotent('diagnostic-operation-001','DIAG',$1,$2,NULL,auth.uid(),5,0,'amount',0,0,5,5,'cash','completed',$3,NULL,'takeaway',NULL,NULL,NULL) result",[branch,warehouse,JSON.stringify([{product_id:product,unit_name:'piece',quantity:2,unit_price:2.50,discount_amount:0,bonus_quantity:0,modifier_option_ids:[]}])]);
   throw Error('CANONICAL_TEST_DIAGNOSTIC '+JSON.stringify({first,canonical:diagnostic.rows[0].result}));
  });
  assert.equal(first.stage,'posted',JSON.stringify(first));assert.equal(first.costMinor,200);
  assert.deepEqual(await post(event),first);assert.deepEqual(await counts(),{sales:1,stock:18,journals:1,posts:1,dedup:1});
  assert.equal(Number((await client.query('SELECT sum(total_cost) total FROM inventory_ledger')).rows[0].total),-2);
  const original=await counts();
  const wrongPrice=makeEvent();await receive(wrongPrice);await client.query('UPDATE products SET sale_price=3 WHERE id=$1',[product]);
  assert.equal((await post(wrongPrice)).reason,'HUB_PRICE_CHANGED');assert.deepEqual(await counts(),original);await client.query('UPDATE products SET sale_price=2.50 WHERE id=$1',[product]);
  const tax=makeEvent();await receive(tax);assert.equal((await post(tax,{'hub_test.tax':'true'})).reason,'HUB_TAX_RULE_CONFLICT');assert.deepEqual(await counts(),original);
  const fault=makeEvent();await receive(fault);assert.equal((await post(fault,{'hub_test.fail_after_stock':'true'})).reason,'HUB_CANONICAL_SALE_REJECTED');assert.deepEqual(await counts(),original);
  const invalidScope=makeEvent();const altered=JSON.parse(invalidScope.text);altered.lines[0].canonical.warehouseId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';altered.lines[0].sku=`p_${product}_${altered.lines[0].canonical.warehouseId}`;invalidScope.text=JSON.stringify(altered);await receive(invalidScope);
  assert.equal((await post(invalidScope)).reason,'HUB_WAREHOUSE_SCOPE_CONFLICT');assert.deepEqual(await counts(),original);
  await assert.rejects(post(event,{'hub_test.admin':'false'}),/BRANCH_ACCESS_DENIED/);
  await assert.rejects(asUser(()=>client.query('UPDATE public.branch_hub_posted_sales SET total_minor=1')),/permission denied/);
  // A rejected event can be retried once the conflict is corrected; it creates one official sale.
  const recovered=await post(fault);assert.equal(recovered.stage,'posted',JSON.stringify(recovered));assert.deepEqual(await post(fault),recovered);
  assert.equal((await counts()).sales,2);assert.equal((await counts()).posts,2);
  // Full local SQLite -> PostgreSQL canonical stock/journal -> durable local ACK, with a lost committed response.
  const {DatabaseSync}=require('node:sqlite');
  const {createOfflineSalesEngine}=require('../offline-sales.cjs');
  const {createCatalogImporter}=require('../catalog-import.cjs');
  const {createCloudSync}=require('../cloud-sync.cjs');
  const local=new DatabaseSync(':memory:');local.exec('PRAGMA foreign_keys=ON');let sync;
  try{
   const engine=createOfflineSalesEngine(local,branch);
   const fresh=(await asUser(()=>client.query('SELECT public.get_branch_hub_catalog_v1($1,$2,$3) snapshot',[org,branch,warehouse]))).rows[0].snapshot;
   createCatalogImporter(local,{organizationId:org,branchId:branch,installationId:installation}).apply(fresh);
   engine.commitSale({key:'full-offline-flow-001',lines:[{sku:fresh.products[0].sku,quantity:1,priceMinor:250}]});
   let drop=true;const before=(await counts()).sales;
   const transport={validateEnrollment:async()=>({}),request:async(route,{body}={})=>{
    if(route.startsWith('/auth/'))return {access_token:'fixture-session',refresh_token:'fixture-refresh',expires_in:3600};
    if(route.includes('receive_branch_hub_sale'))return (await asUser(()=>client.query('SELECT public.receive_branch_hub_sale_v1($1,$2,$3,$4,$5) receipt',[org,branch,installation,body.p_event_id,body.p_payload_text]))).rows[0].receipt;
    if(route.includes('post_branch_hub_sale')){const result=await post({id:body.p_event_id});if(drop){drop=false;throw Error('LOST_CANONICAL_ACK');}return result;}
    if(route.includes('pull_branch_hub_prices'))return (await asUser(()=>client.query('SELECT public.pull_branch_hub_prices_v1($1,$2,$3) commands',[org,branch,installation]))).rows[0].commands;
    if(route.includes('command_receipts')){await asUser(()=>client.query('INSERT INTO public.branch_hub_command_receipts(installation_id,command_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[installation,body.command_id]));return null;}
    throw Error('UNEXPECTED_TRANSPORT_ROUTE');
   }};
   sync=createCloudSync({db:local,client:transport,organizationId:org,branchId:branch,installationId:installation,refreshToken:'fixture-initial',persistRefreshToken:async()=>{}});
   await assert.rejects(sync.run(),/LOST_CANONICAL_ACK/);assert.equal(local.prepare('SELECT status FROM offline_outbox').get().status,'pending');
   await sync.run();await sync.run();
   assert.equal(local.prepare('SELECT status FROM offline_outbox').get().status,'acknowledged');
   assert.equal((await counts()).sales,before+1);
   assert.equal(Number((await counts()).stock),local.prepare('SELECT quantity FROM offline_stock').get().quantity);
   assert.equal(local.prepare('SELECT count(*) n FROM cloud_posted_sales').get().n,1);
  }finally{if(sync)await sync.stop();local.close();}
  console.log('REAL_CANONICAL_SALE_STOCK_JOURNAL_REPLAY_ROLLBACK_OK');
 }finally{await client.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
