import {it,describe,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {APPROVAL,loadCloseoutEvidence,formatMetadataSQL,buildApprovedMetadataProposal,buildReadOnlyCloseoutCheck} from './history-closeout-metadata.mjs';
const url=process.env.HISTORY55_TEST_DB_URL;
if(process.env.CI) assert.ok(url,'CI must run database cases');
if(url) assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
it('pins 147 canonical records, seven explicit variants and three runtime exclusions',async()=>{
  const m=await loadCloseoutEvidence();assert.equal(m.candidates.length,147);assert.equal(m.candidates.filter(f=>f.disposition==='explicit_historical_variant_acceptance_required').length,7);assert.equal(m.runtime_exclusions.length,3);
});
it('requires an explicit seven-variant decision even to generate the production proposal',async()=>{
  await assert.rejects(buildApprovedMetadataProposal(),/EXPLICIT_SEVEN/);
  await assert.rejects(buildApprovedMetadataProposal({approval:APPROVAL}),/EXPLICIT_SEVEN/);
});
it('pins the exact published production SQL artifact',async()=>{
  assert.equal(await buildApprovedMetadataProposal({approval:APPROVAL,acceptSevenHistoricalVariants:true}),await readFile(new URL('./history147_ACK_ONLY_NOT_A_MIGRATION.sql',import.meta.url),'utf8'));
});
it('read-only preflight removes all acknowledgements and writer locks',async()=>{
  const sql=await buildReadOnlyCloseoutCheck();assert.ok(sql.includes('BEGIN READ ONLY;'));assert.ok(sql.includes('ROLLBACK;'));assert.ok(!sql.includes('INSERT INTO public.schema_migrations'));assert.ok(!sql.includes('LOCK TABLE '));
  assert.equal(sql,await readFile(new URL('./history147_READONLY_PREFLIGHT.sql',import.meta.url),'utf8'));
});
describe('147-record metadata transport with synthetic isolated history',{skip:!url},()=>{
  let admin,db,database,m;
  const fingerprint=async(table,key)=>(await db.query(`SELECT md5(coalesce(string_agg(md5(row_to_json(x)::text),'' ORDER BY ${key}),'')) AS hash FROM ${table} x`)).rows[0].hash;
  const snapshot=async()=>JSON.stringify((await db.query('SELECT * FROM public.schema_migrations ORDER BY id')).rows);
  const run=async()=>{try{await db.query(formatMetadataSQL(m));}catch(e){await db.query('ROLLBACK');throw e;}};
  const fail=async(pattern)=>{const b=await snapshot();await assert.rejects(run(),pattern);assert.equal(await snapshot(),b);};
  beforeEach(async()=>{
    const {Client}=await import('pg');admin=new Client({connectionString:url});await admin.connect();
    database='closeout147_'+randomBytes(8).toString('hex');await admin.query(`CREATE DATABASE ${database}`);
    const u=new URL(url);u.pathname='/'+database;db=new Client({connectionString:u.href});await db.connect();
    await db.query(`SET timezone='UTC';CREATE TABLE public.schema_migrations(id bigserial PRIMARY KEY,version text NOT NULL UNIQUE,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      INSERT INTO public.schema_migrations(version,name,checksum) VALUES('unrelated','unrelated.sql','keep');
      CREATE TABLE public.business_sentinel(id integer,value text);INSERT INTO public.business_sentinel VALUES(1,'unchanged');`);
    m=await loadCloseoutEvidence();m.livePins=[];
    // Synthetic source text is inert metadata. Actual production hashes remain
    // separately pinned in the published artifact and fresh read-only receipts.
    for(let i=0;i<m.candidates.length;i++){
      const s='CI_ONLY_METADATA_'+i,version='fixture_'+i,name='synthetic_'+i;
      m.candidates[i].required_history=[{version,name,statement_hashes:[createHash('sha256').update(s).digest('hex')]}];
      await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',[version,name,[s]]);
    }
    m.baseline={custom_rows:1,history_rows:147,custom_fingerprint:await fingerprint('public.schema_migrations','id'),history_fingerprint:await fingerprint('supabase_migrations.schema_migrations','version')};
  });
  afterEach(async()=>{if(db)await db.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);await admin.end();}});
  it('inserts exactly 147, preserves old rows/history/business sentinel, and retries',async()=>{
    const history=await fingerprint('supabase_migrations.schema_migrations','version');await run();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.schema_migrations')).rows[0].n,148);
    const b=await snapshot();await run();assert.equal(await snapshot(),b);assert.equal(await fingerprint('supabase_migrations.schema_migrations','version'),history);
    assert.deepEqual((await db.query('TABLE public.business_sentinel')).rows,[{id:1,value:'unchanged'}]);
  });
  it('completes a matching partial acknowledgement',async()=>{
    const f=m.candidates[0];await db.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[f.version,f.name,f.canonical_sha256]);await run();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.schema_migrations')).rows[0].n,148);
  });
  it('rejects conflicting checksum before any other acknowledgement',async()=>{
    const f=m.candidates[146];await db.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[f.version,f.name,'wrong']);await fail(/CLOSEOUT_LEDGER_CONFLICT/);
  });
  it('rejects changed baseline rows',async()=>{await db.query("UPDATE public.schema_migrations SET checksum='changed'");await fail(/CLOSEOUT_BASELINE_DRIFT/);});
  it('rejects history drift',async()=>{await db.query("UPDATE supabase_migrations.schema_migrations SET name='changed'");await fail(/CLOSEOUT_HISTORY_DRIFT/);});
  it('checks individual pinned source hashes beyond the global fingerprint',async()=>{
    await db.query("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['different'] WHERE version='fixture_146'");m.baseline.history_fingerprint=await fingerprint('supabase_migrations.schema_migrations','version');await fail(/CLOSEOUT_SOURCE_DRIFT/);
  });
  it('rejects triggers that could write business data',async()=>{
    await db.query(`CREATE FUNCTION public.bad() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.business_sentinel SET value='bad';RETURN NEW;END $$;
      CREATE TRIGGER bad BEFORE INSERT ON public.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.bad()`);await fail(/CLOSEOUT_LEDGER_SIDE_EFFECTS/);
    assert.equal((await db.query('TABLE public.business_sentinel')).rows[0].value,'unchanged');
  });
  it('rejects schema drift',async()=>{await db.query('ALTER TABLE public.schema_migrations ADD COLUMN extra text');await fail(/CLOSEOUT_LEDGER_SCHEMA_DRIFT/);});
  it('rejects missing live pin',async()=>{m.livePins=[{signature:'public.never_exists()',sha256:'bad',acl:null,security_definer:false}];await fail(/CLOSEOUT_LIVE_DRIFT/);});
  it('rolls back 146 actual inserts when the final insert fails',async()=>{
    await db.query("UPDATE public.schema_migrations SET id=147;SELECT setval('public.schema_migrations_id_seq',1,false)");m.baseline.custom_fingerprint=await fingerprint('public.schema_migrations','id');await fail(/duplicate key/);
    assert.equal(Number((await db.query('SELECT last_value FROM public.schema_migrations_id_seq')).rows[0].last_value),147);
  });
});
