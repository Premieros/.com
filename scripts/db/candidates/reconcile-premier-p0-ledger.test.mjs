import { before, beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT, assertTarget, loadEvidence, reconcile } from './reconcile-premier-p0-ledger.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const url = process.env.P0_LEDGER_TEST_DB_URL;
if (url) {
  const parsed = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname), 'Disposable localhost PostgreSQL only');
}

it('rejects incorrect project and connection identities before any SQL', async () => {
  assert.throws(() => assertTarget('localhost', 'postgres', PROJECT), /CONNECTION_IDENTITY/);
  assert.throws(() => assertTarget(`db.${PROJECT}.supabase.co`, 'postgres', 'wrong'), /PROJECT_MISMATCH/);
  assert.throws(() => assertTarget('db.wrong.supabase.co', 'postgres', PROJECT), /CONNECTION_IDENTITY/);
  assert.throws(() => assertTarget('aws-0-eu-central-1.pooler.supabase.com', 'postgres.wrong', PROJECT), /CONNECTION_IDENTITY/);
  assert.throws(() => assertTarget('example.com', 'postgres', PROJECT, true), /TEST_LOCALHOST_ONLY/);
  assert.doesNotThrow(() => assertTarget(`db.${PROJECT}.supabase.co`, 'postgres', PROJECT));
  assert.doesNotThrow(() => assertTarget('aws-0-eu-central-1.pooler.supabase.com', `postgres.${PROJECT}`, PROJECT));
  let calls = 0;
  await assert.rejects(reconcile({connectionParameters:{host:'localhost',user:'postgres'},
    query: async () => { calls++; }}, {project:PROJECT,execute:true}), /CONNECTION_IDENTITY/);
  assert.equal(calls, 0);
});

it('verifies immutable local files against pinned production hashes', async () => {
  assert.equal((await loadEvidence()).migrations.length, 3);
});

describe('isolated PostgreSQL ledger reconciliation', {skip: !url}, () => {
  let Client, admin, client, database, manifest;
  const options = {project:PROJECT,execute:true,testOnly:true};
  before(async () => { ({Client} = await import('pg')); manifest = await loadEvidence(); });
  beforeEach(async () => {
    admin = new Client({connectionString:url});
    await admin.connect();
    database = 'p0_ledger_' + randomBytes(8).toString('hex');
    await admin.query(`CREATE DATABASE ${database}`);
    const testUrl = new URL(url); testUrl.pathname = '/' + database;
    client = new Client({connectionString:testUrl.href});
    await client.connect();
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE public.schema_migrations(
      id bigserial PRIMARY KEY, version text NOT NULL UNIQUE, name text NOT NULL,
      checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
    SET check_function_bodies=off;`);
    // Store production definitions without invoking business functions or copying business rows.
    for (const m of manifest.migrations) {
      await client.query('INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)',
        [m.version,m.name,[await readFile(resolve(ROOT,m.archive),'utf8')]]);
    }
    for (const f of manifest.functions) {
      await client.query(await readFile(resolve(ROOT,f.archive),'utf8'));
      await client.query(`REVOKE ALL ON FUNCTION public.${f.signature} FROM PUBLIC,anon,authenticated,service_role`);
      if (f.authenticated_execute) await client.query(`GRANT EXECUTE ON FUNCTION public.${f.signature} TO authenticated`);
      await client.query(`GRANT EXECUTE ON FUNCTION public.${f.signature} TO service_role`);
    }
    await client.query("INSERT INTO public.schema_migrations(version,name,checksum) VALUES('unrelated','unrelated.sql','keep')");
  });
  afterEach(async () => {
    if (client) await client.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); await admin.end(); }
  });
  const rows = async () => (await client.query('SELECT version,name,checksum FROM public.schema_migrations ORDER BY version')).rows;
  const remote = async () => (await client.query('SELECT * FROM supabase_migrations.schema_migrations ORDER BY version')).rows;

  it('default check is read-only and leaves both ledgers unchanged', async () => {
    const before = await rows(), history = await remote();
    const result = await reconcile(client,{project:PROJECT,testOnly:true});
    assert.equal(result.mode,'read-only'); assert.equal(result.inserted,0); assert.equal(result.missing.length,3);
    assert.deepEqual(await rows(),before); assert.deepEqual(await remote(),history);
  });
  it('adds exactly three metadata records and retries without duplicates', async () => {
    const history = await remote();
    assert.equal((await reconcile(client,options)).inserted,3);
    const first = await rows();
    assert.equal(first.length,4);
    assert.equal((await reconcile(client,options)).inserted,0);
    assert.deepEqual(await rows(),first); assert.deepEqual(await remote(),history);
  });
  it('completes a previously partially acknowledged set without changing matching rows', async () => {
    const m=manifest.migrations[0], stem=m.canonical_path.split('/').pop().slice(0,-4);
    await client.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[stem,stem+'.sql',m.sha256]);
    assert.equal((await reconcile(client,options)).inserted,2);
  });
  it('rejects a conflicting existing checksum without acknowledging any other patch', async () => {
    const m=manifest.migrations[1], stem=m.canonical_path.split('/').pop().slice(0,-4);
    await client.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[stem,stem+'.sql','wrong']);
    const before=await rows();
    await assert.rejects(reconcile(client,options),/LEDGER_RECORD_CONFLICT/);
    assert.deepEqual(await rows(),before);
  });
  it('rejects drift in a recorded production migration', async () => {
    await client.query("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['changed'] WHERE version=$1",[manifest.migrations[1].version]);
    const before=await rows();
    await assert.rejects(reconcile(client,options),/REMOTE_MIGRATION_DRIFT/);
    assert.deepEqual(await rows(),before);
  });
  it('rejects live function definition drift', async () => {
    await client.query(`CREATE OR REPLACE FUNCTION public.apply_stock_count(p_stock_count_id uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
      AS $$ BEGIN RETURN '{}'::jsonb; END $$`);
    await assert.rejects(reconcile(client,options),/LIVE_FUNCTION_DRIFT/);
    assert.equal((await rows()).length,1);
  });
  it('rejects widened live function privileges', async () => {
    await client.query('GRANT EXECUTE ON FUNCTION public.get_stock_valuation(uuid,uuid) TO anon');
    await assert.rejects(reconcile(client,options),/LIVE_FUNCTION_DRIFT/);
    assert.equal((await rows()).length,1);
  });
  it('rejects ledger triggers even if the trigger appears harmless', async () => {
    await client.query(`CREATE FUNCTION public.test_ledger_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER test_ledger BEFORE INSERT ON public.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.test_ledger_trigger()`);
    await assert.rejects(reconcile(client,options),/LEDGER_SIDE_EFFECTS/);
  });
  it('rejects ledger schema drift', async () => {
    await client.query('ALTER TABLE public.schema_migrations ADD COLUMN unexpected text');
    await assert.rejects(reconcile(client,options),/LEDGER_SCHEMA_DRIFT/);
  });
  it('rolls back the first insertion when the second SQL insertion fails', async () => {
    const before=await rows(), query=client.query.bind(client);
    let inserts=0;
    client.query=async (...args) => {
      if (args[0].startsWith('INSERT INTO public.schema_migrations') && ++inserts===2) {
        // Actual PostgreSQL division error aborts the transaction after the first insert.
        await query('SELECT 1/0');
      }
      return query(...args);
    };
    await assert.rejects(reconcile(client,options),/RECONCILIATION_ABORTED/);
    client.query=query;
    assert.equal(inserts,2); assert.deepEqual(await rows(),before);
  });
});
