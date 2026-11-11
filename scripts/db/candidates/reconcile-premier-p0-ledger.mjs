// REVIEW CANDIDATE. Never imported or executed by the migration runner.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const PROJECT = 'hvqlkapynjfjikqithvd';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ARCHIVE = 'docs/database/production-p0-20261110/';
const PINNED = [
  ['20261110104453', '20261109180000_premier_stock_valuation_rpc_branch_auth', '4855885a35e2ee544d7911fae9a21da729a20c6f7a5455624c2de9fbec3e4625'],
  ['20261110104523', '20261109183000_premier_refund_core_atomic_failure', '2c9a027612c030fa4e3b59eb134ea40e43ae4ccf190c19e04db916b29e035699'],
  ['20261110104600', '20261109140000_premier_stock_count_atomic_failures', 'a891b7c62043fc3e9632a5b304950020da984d09a6fae6cf1035e74c33e26fed'],
];
const FUNCTION_PINS = [
  ['get_stock_valuation(uuid,uuid)', 'b74eab3a0c2d0514ccfb5537f1381b109b14f7f7e87b8b22d132d448019fd07a'],
  ['_process_refund_single_core(uuid,jsonb,text)', '57bd2920ff372a280ed7d755407a1592f57ae0e3e7ec9ef45a33c65017c3e10b'],
  ['apply_stock_count(uuid)', 'ab1dcab7df1d1a033dc699b3d93cd79d8403e6521d24ee5b8ea87de62679d98f'],
];
function requireThat(ok, code) { if (!ok) throw new Error(code); }
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function assertTarget(host, user, project, testOnly = false) {
  requireThat(project === PROJECT, 'PROJECT_MISMATCH');
  if (testOnly) {
    requireThat(['localhost', '127.0.0.1', '::1'].includes(host), 'TEST_LOCALHOST_ONLY');
    return;
  }
  const direct = host === `db.${PROJECT}.supabase.co` && user === 'postgres';
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
    && user === `postgres.${PROJECT}`;
  requireThat(direct || pooler, 'CONNECTION_IDENTITY_MISMATCH');
}

export async function loadEvidence() {
  const rawManifest = await readFile(resolve(ROOT, ARCHIVE, 'manifest.json'), 'utf8');
  requireThat(hash(rawManifest) === '2c62666d4e9b0081a4515a4ded3785bc5052634127e36fb29a3c288be8339cf7', 'MANIFEST_HASH_DRIFT');
  const manifest = JSON.parse(rawManifest);
  requireThat(manifest.project_ref === PROJECT, 'MANIFEST_PROJECT_MISMATCH');
  requireThat(manifest.migrations.length === 3 && manifest.functions.length === 3, 'MANIFEST_SCOPE');
  for (const [version, stem, checksum] of PINNED) {
    const m = manifest.migrations.find(m => m.version === version);
    requireThat(m && m.canonical_path === `supabase/migrations/${stem}.sql`
      && m.sha256 === checksum && m.statement_count === 1, 'MANIFEST_MIGRATION_DRIFT');
    const canonical = await readFile(resolve(ROOT, m.canonical_path), 'utf8');
    requireThat(hash(canonical) === checksum, 'CANONICAL_FILE_DRIFT');
    requireThat(m.archive.startsWith(ARCHIVE + 'migrations/') && !m.archive.includes('..'), 'ARCHIVE_PATH');
    requireThat(await readFile(resolve(ROOT, m.archive), 'utf8') === canonical, 'ARCHIVE_DRIFT');
  }
  for (const [signature, checksum] of FUNCTION_PINS) {
    const f = manifest.functions.find(f => f.signature === signature);
    requireThat(f && f.sha256 === checksum && f.archive.startsWith(ARCHIVE + 'functions/')
      && !f.archive.includes('..'), 'MANIFEST_FUNCTION_DRIFT');
    requireThat(hash(await readFile(resolve(ROOT, f.archive), 'utf8')) === checksum, 'FUNCTION_ARCHIVE_DRIFT');
  }
  return manifest;
}

async function inspect(client, manifest) {
  const columns = (await client.query(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations'
    ORDER BY ordinal_position`)).rows;
  const expected = [
    ['id', 'bigint', "nextval('schema_migrations_id_seq'::regclass)"],
    ['version', 'text', null], ['name', 'text', null], ['checksum', 'text', null],
    ['applied_at', 'timestamp with time zone', 'now()'],
  ];
  requireThat(columns.length === expected.length && columns.every((c, i) =>
    c.column_name === expected[i][0] && c.data_type === expected[i][1]
      && c.column_default === expected[i][2] && c.is_nullable === 'NO'), 'LEDGER_SCHEMA_DRIFT');
  const meta = (await client.query(`SELECT relkind, relrowsecurity,
    (SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers,
    (SELECT count(*)::int FROM pg_rewrite WHERE ev_class=c.oid) AS rules
    FROM pg_class c WHERE c.oid='public.schema_migrations'::regclass`)).rows[0];
  requireThat(meta?.relkind === 'r' && meta.relrowsecurity && meta.triggers === 0 && meta.rules === 0,
    'LEDGER_SIDE_EFFECTS');
  const constraints = (await client.query(`SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='public.schema_migrations'::regclass ORDER BY 1`)).rows;
  requireThat(JSON.stringify(constraints.map(c => c.definition)) ===
    JSON.stringify(['PRIMARY KEY (id)', 'UNIQUE (version)']), 'LEDGER_CONSTRAINT_DRIFT');

  for (const [version, stem, checksum] of PINNED) {
    const remote = (await client.query(`SELECT name, statements FROM supabase_migrations.schema_migrations
      WHERE version=$1`, [version])).rows;
    const m = manifest.migrations.find(m => m.version === version);
    requireThat(remote.length === 1 && remote[0].name === m.name
      && remote[0].statements?.length === 1 && hash(remote[0].statements[0]) === checksum,
    'REMOTE_MIGRATION_DRIFT');
    const existing = (await client.query(`SELECT version,name,checksum FROM public.schema_migrations
      WHERE version=$1 OR name=$2`, [stem, stem + '.sql'])).rows;
    requireThat(existing.length === 0 || (existing.length === 1 && existing[0].version === stem
      && existing[0].name === stem + '.sql' && existing[0].checksum === checksum), 'LEDGER_RECORD_CONFLICT');
  }
  for (const [signature, checksum] of FUNCTION_PINS) {
    const p = (await client.query(`SELECT pg_get_functiondef(p.oid) AS definition,
      p.proacl::text AS acl, p.prosecdef, p.provolatile, p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
      FROM pg_proc p WHERE p.oid=to_regprocedure($1)`, ['public.' + signature])).rows[0];
    const f = manifest.functions.find(f => f.signature === signature);
    requireThat(p && hash(p.definition) === checksum && p.acl === f.acl
      && p.prosecdef === f.security_definer && p.provolatile === f.volatility
      && JSON.stringify(p.proconfig) === JSON.stringify(f.config)
      && p.anon_execute === f.anon_execute && p.authenticated_execute === f.authenticated_execute,
    'LIVE_FUNCTION_DRIFT');
  }
}

async function remoteFingerprint(client) {
  return (await client.query(`SELECT md5(coalesce(string_agg(md5(row_to_json(m)::text),'' ORDER BY version),'')) AS hash
    FROM supabase_migrations.schema_migrations m`)).rows[0].hash;
}

export async function reconcile(client, { project, execute = false, testOnly = false } = {}) {
  const cp = client.connectionParameters;
  assertTarget(cp.host, cp.user, project, testOnly);
  const manifest = await loadEvidence();
  let begun = false;
  try {
    await client.query(execute ? 'BEGIN' : 'BEGIN READ ONLY');
    begun = true;
    const role = (await client.query(`SELECT current_user AS name, rolsuper OR rolbypassrls AS bypass
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    requireThat(role?.name === 'postgres' && role.bypass, 'DATABASE_ROLE_MISMATCH');
    await client.query("SET LOCAL search_path TO pg_catalog, public");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    if (execute) {
      // Serialize custom-ledger writers; block concurrent remote history writes.
      await client.query('LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE');
      await client.query('LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE');
    }
    await inspect(client, manifest);
    const remoteBefore = await remoteFingerprint(client);
    const before = Number((await client.query('SELECT count(*) AS n FROM public.schema_migrations')).rows[0].n);
    let inserted = 0;
    const missing = [];
    for (const [, stem, checksum] of PINNED) {
      const exists = (await client.query('SELECT 1 FROM public.schema_migrations WHERE version=$1', [stem])).rowCount;
      if (!exists) {
        missing.push(stem);
        if (execute) {
          await client.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
            [stem, stem + '.sql', checksum]);
          inserted += 1;
        }
      }
    }
    await inspect(client, manifest);
    const after = Number((await client.query('SELECT count(*) AS n FROM public.schema_migrations')).rows[0].n);
    requireThat(after === before + inserted, 'LEDGER_ROW_COUNT_CHANGED');
    requireThat(await remoteFingerprint(client) === remoteBefore, 'REMOTE_HISTORY_CHANGED');
    await client.query(execute ? 'COMMIT' : 'ROLLBACK');
    begun = false;
    return { mode: execute ? 'metadata-only' : 'read-only', missing, inserted,
      ledgerRowsBefore: before, ledgerRowsAfter: after, remoteHistoryUnchanged: true };
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    // Do not print SQL, credentials, connection URLs, row contents or raw DB errors.
    const safe = /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'RECONCILIATION_ABORTED';
    throw new Error(safe);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  requireThat(args.every(a => ['--check', '--execute', '--approved-project=' + PROJECT,
    '--approval=P0_LEDGER_METADATA_ONLY'].includes(a)), 'UNKNOWN_ARGUMENT');
  requireThat(!(args.includes('--check') && execute), 'CONFLICTING_MODE');
  requireThat(!execute || (args.includes('--approved-project=' + PROJECT)
    && args.includes('--approval=P0_LEDGER_METADATA_ONLY')), 'EXPLICIT_APPROVAL_FLAGS_REQUIRED');
  const url = process.env.SUPABASE_DB_URL;
  requireThat(Boolean(url), 'DATABASE_URL_REQUIRED');
  // URL TLS options can override node-postgres ssl configuration; forbid them.
  const parsed = new URL(url);
  requireThat(['postgres:', 'postgresql:'].includes(parsed.protocol) && !parsed.search, 'DATABASE_URL_OPTIONS');
  const { Client } = await import('pg');
  // Always verify TLS for hosted connections. Never accepts a local test override in the CLI.
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000, query_timeout: 20000 });
  assertTarget(client.connectionParameters.host, client.connectionParameters.user, PROJECT);
  try {
    await client.connect();
    console.log(JSON.stringify(await reconcile(client, { project: PROJECT, execute })));
  } finally { await client.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('P0_LEDGER_RECONCILIATION_ABORTED'); process.exitCode = 1; });
}
