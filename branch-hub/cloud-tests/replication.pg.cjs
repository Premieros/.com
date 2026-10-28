'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
const org='11111111-1111-4111-8111-111111111111',branch='22222222-2222-4222-8222-222222222222',other='88888888-8888-4888-8888-888888888888';
const installation='44444444-4444-4444-8444-444444444444',event=crypto.randomUUID();
async function main(){
 const client=new Client({connectionString:process.env.HUB_TEST_DATABASE_URL});await client.connect();
 const asUser=async(fn,admin=true)=>{
  await client.query('BEGIN');
  try{
   await client.query("SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='33333333-3333-4333-8333-333333333333'");
   await client.query("SELECT set_config('hub_test.admin',$1,true),set_config('hub_test.branch',$2,true)",[String(admin),branch]);
   const result=await fn();await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}
 };
 try{
  await client.query(fs.readFileSync(path.join(__dirname,'fixtures.sql'),'utf8'));
  const migrations=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(x=>x.endsWith('.sql'));
  for(const file of migrations)await client.query(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
  const payload=JSON.stringify({saleId:event,branchId:branch,key:'postgres-replay-001',totalMinor:500,paymentAccount:'cash',lines:[{sku:'coffee',quantity:2,priceMinor:250,costMinor:200}]});
  const receive=(text=payload,eventId=event,orgId=org,branchId=branch)=>client.query('SELECT public.receive_branch_hub_sale_v1($1,$2,$3,$4,$5) receipt',[orgId,branchId,installation,eventId,text]);
  const a=await asUser(()=>receive()),b=await asUser(()=>receive());assert.deepEqual(a.rows,b.rows);
  assert.equal(a.rows[0].receipt.stage,'received');assert.equal(a.rows[0].receipt.payloadHash,crypto.createHash('sha256').update(payload).digest('hex'));
  await assert.rejects(asUser(()=>receive(),false),/BRANCH_ACCESS_DENIED/);
  await assert.rejects(asUser(()=>receive(payload,event,org,other)),/BRANCH_ACCESS_DENIED/);
  await assert.rejects(asUser(()=>receive(payload.replace('500','501'))),/INVALID_HUB_AMOUNTS/);
  await assert.rejects(asUser(()=>receive(payload.replace('cash','bank'))),/HUB_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(asUser(()=>client.query('UPDATE public.branch_hub_replicated_sales SET checkout_key=$1',['changed'])),/permission denied/);
  await assert.rejects(asUser(()=>client.query('DELETE FROM public.branch_hub_replicated_sales')),/permission denied/);
  const hidden=await asUser(()=>client.query('SELECT * FROM public.branch_hub_replicated_sales WHERE branch_id=$1',[other]));assert.equal(hidden.rows.length,0);
  const command=crypto.randomUUID();
  await asUser(()=>client.query('INSERT INTO public.branch_hub_price_commands(id,organization_id,branch_id,sku,revision,sale_price_minor,unit_cost_minor) VALUES($1,$2,$3,$4,1,250,100)',[command,org,branch,'coffee']));
  const pull=()=>client.query('SELECT public.pull_branch_hub_prices_v1($1,$2,$3) commands',[org,branch,installation]);
  assert.equal((await asUser(pull)).rows[0].commands.length,1);
  await asUser(()=>client.query('INSERT INTO public.branch_hub_command_receipts(installation_id,command_id) VALUES($1,$2)',[installation,command]));
  assert.equal((await asUser(pull)).rows[0].commands.length,0);
  assert.equal((await client.query('SELECT count(*)::int n FROM public.branch_hub_replicated_sales')).rows[0].n,1);
  console.log('POSTGRES_RLS_REPLICATION_REPLAY_OK');
 }finally{await client.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
