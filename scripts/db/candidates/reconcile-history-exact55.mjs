// REVIEW ONLY: no deployment integration or hosted execution transport.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../../../', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const demand = (ok, code) => { if (!ok) throw new Error(code); };
export async function evidence() {
  const raw = await readFile(new URL('docs/database/migration-history-audit-20261110/matrix.json', root));
  demand(sha(raw) === '642ab7835967c26a8f8d07264012a14a4a2c14b3949fdf8dbd833ae6561329cb', 'MATRIX_DRIFT');
  const files = JSON.parse(raw).files.filter(f => f.category === 'byte_exact' && f.matches.length === 1);
  demand(files.length === 55 && new Set(files.map(f => f.matches[0].version)).size === 55, 'SCOPE_DRIFT');
  for (const f of files) {
    demand(sha(await readFile(new URL(f.canonical_path, root))) === f.canonical_sha256, 'CANONICAL_DRIFT');
    demand(f.matches[0].production_statement_sha256 === f.canonical_sha256, 'HASH_MISMATCH');
  }
  return files;
}
export async function reconcile(client, { execute = false } = {}) {
  // Intentionally impossible to target hosted production in this preparation stage.
  demand(['localhost', '127.0.0.1', '::1'].includes(client.connectionParameters.host)
    && client.connectionParameters.user === 'postgres', 'DISPOSABLE_LOCALHOST_ONLY');
  const files = await evidence();
  let begun = false;
  try {
    await client.query(execute ? 'BEGIN' : 'BEGIN READ ONLY'); begun = true;
    await client.query("SET LOCAL search_path = pg_catalog, public");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    if (execute) {
      await client.query('LOCK TABLE public.schema_migrations IN SHARE ROW EXCLUSIVE MODE');
      await client.query('LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE');
    }
    const cols = (await client.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='schema_migrations' ORDER BY ordinal_position`)).rows;
    const expected = [['id','bigint',"nextval('schema_migrations_id_seq'::regclass)"],['version','text',null],
      ['name','text',null],['checksum','text',null],['applied_at','timestamp with time zone','now()']];
    demand(cols.length === 5 && cols.every((c,i) => c.column_name === expected[i][0]
      && c.data_type === expected[i][1] && c.is_nullable === 'NO' && c.column_default === expected[i][2]), 'LEDGER_SCHEMA_DRIFT');
    const meta = (await client.query(`SELECT relkind,relrowsecurity,relispartition,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM pg_rewrite WHERE ev_class=c.oid) AS rules,
      (SELECT count(*)::int FROM pg_inherits WHERE inhparent=c.oid OR inhrelid=c.oid) AS inheritance
      FROM pg_class c WHERE oid='public.schema_migrations'::regclass`)).rows[0];
    demand(meta?.relkind === 'r' && meta.relrowsecurity && !meta.relispartition
      && !meta.triggers && !meta.rules && !meta.inheritance, 'LEDGER_SIDE_EFFECTS');
    const constraints = (await client.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
      WHERE conrelid='public.schema_migrations'::regclass ORDER BY 1`)).rows.map(r => r.d);
    demand(JSON.stringify(constraints) === JSON.stringify(['PRIMARY KEY (id)','UNIQUE (version)']), 'LEDGER_CONSTRAINT_DRIFT');
    const history = async () => JSON.stringify((await client.query('SELECT * FROM supabase_migrations.schema_migrations ORDER BY version')).rows);
    const ledger = async () => (await client.query('SELECT * FROM public.schema_migrations ORDER BY id')).rows;
    const beforeHistory = await history(), before = await ledger();
    const pending = [];
    for (const f of files) {
      const m = f.matches[0], name = f.canonical_path.split('/').pop(), version = name.slice(0,-4);
      const rows = (await client.query('SELECT name,statements FROM supabase_migrations.schema_migrations WHERE version=$1',[m.version])).rows;
      demand(rows.length === 1 && rows[0].name === m.name && rows[0].statements?.length === 1
        && sha(rows[0].statements[0]) === f.canonical_sha256, 'REMOTE_HISTORY_DRIFT');
      const existing = before.filter(r => r.version === version || r.name === name);
      demand(existing.length === 0 || (existing.length === 1 && existing[0].version === version
        && existing[0].name === name && existing[0].checksum === f.canonical_sha256), 'LEDGER_CONFLICT');
      if (!existing.length) pending.push([version,name,f.canonical_sha256]);
    }
    if (execute) for (const row of pending) {
      await client.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)', row);
    }
    const after = await ledger();
    demand(after.length === before.length + (execute ? pending.length : 0), 'ROW_COUNT_DRIFT');
    demand(before.every(r => JSON.stringify(after.find(a => a.id === r.id)) === JSON.stringify(r)), 'EXISTING_ROW_DRIFT');
    demand(await history() === beforeHistory, 'REMOTE_HISTORY_CHANGED');
    await client.query(execute ? 'COMMIT' : 'ROLLBACK'); begun = false;
    return { missing: pending.length, inserted: execute ? pending.length : 0 };
  } catch (error) {
    if (begun) await client.query('ROLLBACK');
    throw new Error(/^[A-Z_]+$/.test(error.message) ? error.message : 'RECONCILIATION_ABORTED');
  }
}
