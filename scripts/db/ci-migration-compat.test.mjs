import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeHistoricalMigrationForCi, assertCiReplayOnly } from './ci-migration-compat.js';

const filename = '20261023150600_raw_published_price_asof_helper.sql';
const pathname = join(process.cwd(), 'supabase', 'migrations', filename);
const historical = readFileSync(pathname, 'utf8');

test('CI replay repairs only the pinned historical function terminator in memory', () => {
  const result = normalizeHistoricalMigrationForCi(pathname, historical);
  assert.notEqual(result, historical);
  assert.equal(result.includes('$function$;\n\nREVOKE ALL ON FUNCTION private.raw_published_unit_cost_at_v2'), true);
  assert.equal(result.replace('$function$;\n\nREVOKE ALL ON FUNCTION private.raw_published_unit_cost_at_v2',
    '$function$\n\nREVOKE ALL ON FUNCTION private.raw_published_unit_cost_at_v2'), historical);
  assert.equal(normalizeHistoricalMigrationForCi('unrelated.sql', historical), historical);
});

test('rejects any drift in the historical SQL and never silently weakens a migration', () => {
  assert.throws(() => normalizeHistoricalMigrationForCi(pathname, historical + ' '),
    /CI_HISTORICAL_MIGRATION_CONTENT_DRIFT/);
});

test('allows CI replay only with explicit CI=true and a localhost PostgreSQL URL', () => {
  assert.doesNotThrow(() => assertCiReplayOnly({
    env: { CI: 'true' }, databaseUrl: 'postgresql://postgres:postgres@localhost:5432/postgres',
  }));
  for (const databaseUrl of [
    'postgresql://postgres:postgres@somewhere.example.com/postgres',
    'postgresql://postgres:postgres@db.real.supabase.co:5432/postgres',
    'not-a-valid-url',
  ]) {
    assert.throws(() => assertCiReplayOnly({ env: { CI: 'true' }, databaseUrl }), /CI_HISTORICAL_REPLAY_/);
  }
  assert.throws(() => assertCiReplayOnly({
    env: { CI: 'false' }, databaseUrl: 'postgresql://postgres:postgres@localhost/postgres',
  }), /CI_HISTORICAL_REPLAY_REQUIRES_CI/);
});

test('original migration remains byte-identical and keeps its canonical checksum', () => {
  assert.equal(createHash('sha256').update(readFileSync(pathname, 'utf8')).digest('hex'),
    createHash('sha256').update(historical).digest('hex'));
});
