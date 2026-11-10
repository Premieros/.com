import { it, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { evidence, reconcile } from './reconcile-history-exact55.mjs';
const url = process.env.HISTORY55_TEST_DB_URL;
if (process.env.CI) assert.ok(url, 'CI must execute database cases');
if (url) assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
it('pins exactly 55 canonical files and excludes ambiguous/nonexact cases', async () => {
  assert.equal((await evidence()).length,55);
});
it('rejects hosted connections before any SQL', async () => {
  let calls=0;
  await assert.rejects(reconcile({connectionParameters:{host:'db.hvqlkapynjfjikqithvd.supabase.co',user:'postgres'},
    query:async()=>{ calls++; }} ,{execute:true}), /DISPOSABLE_LOCALHOST_ONLY/);
  assert.equal(calls,0);
});
describe('exact55 isolated PostgreSQL', {skip:!url}, () => {
  let admin,client,database,files;
  beforeEach(async () => {
    const {Client}=await import('pg'); files=await evidence();
    admin=new Client({connectionString:url}); await admin.connect();
    database='history55_'+randomBytes(8).toString('hex');
    await admin.query(`CREATE DATABASE ${database}`);
    const dbUrl=new URL(url); dbUrl.pathname='/'+database;
    client=new Client({connectionString:dbUrl.href}); await client.connect();
    await client.query(`CREATE TABLE public.schema_migrations(id bigserial PRIMARY KEY,version text NOT NULL UNIQUE,
      name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      CREATE TABLE public.business_sentinel(id integer PRIMARY KEY,value text);
      INSERT INTO public.business_sentinel VALUES(1,'unchanged');
      INSERT INTO public.schema_migrations(version,name,checksum) VALUES('unrelated','unrelated.sql','keep');`);
    // SQL is stored as metadata, never executed. No production business rows copied.
    for (const f of files) await client.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',
      [f.matches[0].version,f.matches[0].name,[await readFile(new URL('../../../'+f.canonical_path,import.meta.url),'utf8')]]);
  });
  afterEach(async () => {
    if(client) await client.end();
    if(admin) {await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); await admin.end();}
  });
  const snapshot=async()=>JSON.stringify((await client.query('SELECT * FROM public.schema_migrations ORDER BY id')).rows);
  const fail=async(pattern)=>{const b=await snapshot(); await assert.rejects(reconcile(client,{execute:true}),pattern); assert.equal(await snapshot(),b);};
  it('defaults to read only',async()=>{const b=await snapshot(); assert.deepEqual(await reconcile(client),{missing:55,inserted:0});assert.equal(await snapshot(),b);});
  it('inserts all 55, preserves existing rows/history/business data, retries without duplicates',async()=>{
    const history=JSON.stringify((await client.query('TABLE supabase_migrations.schema_migrations')).rows);
    assert.equal((await reconcile(client,{execute:true})).inserted,55);
    const b=await snapshot();assert.equal((await reconcile(client,{execute:true})).inserted,0);assert.equal(await snapshot(),b);
    assert.equal(JSON.stringify((await client.query('TABLE supabase_migrations.schema_migrations')).rows),history);
    assert.deepEqual((await client.query('TABLE public.business_sentinel')).rows,[{id:1,value:'unchanged'}]);
  });
  it('completes partial acknowledgement',async()=>{
    const f=files[0],name=f.canonical_path.split('/').pop();
    await client.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[name.slice(0,-4),name,f.canonical_sha256]);
    assert.equal((await reconcile(client,{execute:true})).inserted,54);
  });
  it('rejects checksum conflicts before inserts',async()=>{
    const name=files[54].canonical_path.split('/').pop();
    await client.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[name.slice(0,-4),name,'bad']);await fail(/LEDGER_CONFLICT/);
  });
  it('rejects filename alias conflict',async()=>{
    await client.query('UPDATE public.schema_migrations SET name=$1',[files[0].canonical_path.split('/').pop()]);await fail(/LEDGER_CONFLICT/);
  });
  for(const [label,sql] of [
    ['changed SQL',"UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['changed']"],
    ['extra statement',"UPDATE supabase_migrations.schema_migrations SET statements=array_append(statements,'SELECT 1')"],
    ['changed remote name',"UPDATE supabase_migrations.schema_migrations SET name='changed'"],
    ['missing remote record','DELETE FROM supabase_migrations.schema_migrations']
  ]) it('rejects '+label,async()=>{await client.query(sql);await fail(/REMOTE_HISTORY_DRIFT/);});
  it('rejects ledger schema drift',async()=>{await client.query('ALTER TABLE public.schema_migrations ADD COLUMN extra text');await fail(/LEDGER_SCHEMA_DRIFT/);});
  it('rejects ledger trigger',async()=>{
    await client.query(`CREATE FUNCTION public.bad_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.business_sentinel SET value='bad';RETURN NEW;END $$;
      CREATE TRIGGER bad BEFORE INSERT ON public.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.bad_trigger()`);
    await fail(/LEDGER_SIDE_EFFECTS/);
    assert.equal((await client.query('TABLE public.business_sentinel')).rows[0].value,'unchanged');
  });
  it('rejects disabled RLS',async()=>{await client.query('ALTER TABLE public.schema_migrations DISABLE ROW LEVEL SECURITY');await fail(/LEDGER_SIDE_EFFECTS/);});
  it('rolls back 54 successful inserts when final insert fails',async()=>{
    await client.query("UPDATE public.schema_migrations SET id=55; SELECT setval('public.schema_migrations_id_seq',1,false)");
    await fail(/RECONCILIATION_ABORTED/);
    assert.equal(Number((await client.query('SELECT last_value FROM public.schema_migrations_id_seq')).rows[0].last_value),55);
  });
  it('fails safely on concurrent writer lock',async()=>{
    const {Client}=await import('pg');const c=new Client({...client.connectionParameters});await c.connect();
    try{await c.query('BEGIN; LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE');await fail(/RECONCILIATION_ABORTED/);}
    finally{await c.query('ROLLBACK');await c.end();}
  });
});
