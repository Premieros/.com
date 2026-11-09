import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectBuildAssets, prepareOfflineWorker, renderOfflineWorker, MARKER, CACHE_MARKER } from './prepare-sw.mjs';

const template = [
  CACHE_MARKER,
  MARKER,
  'self.addEventListener("fetch", () => {});',
].join('\n');

test('offline build caches all lazy JS and CSS chunks, never data files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'premier-offline-'));
  try {
    await mkdir(join(dir, 'assets'));
    for (const file of ['index-a.js', 'lazy-pos-b.js', 'lazy-accounting-c.js', 'style-d.css', 'user-data.json']) {
      await writeFile(join(dir, 'assets', file), 'fixture');
    }
    await writeFile(join(dir, 'sw.js'), template);
    const files = await collectBuildAssets(dir);
    assert.deepEqual(files, ['/assets/index-a.js', '/assets/lazy-accounting-c.js', '/assets/lazy-pos-b.js', '/assets/style-d.css']);
    await prepareOfflineWorker(dir);
    const worker = await readFile(join(dir, 'sw.js'), 'utf8');
    assert.ok(worker.includes('lazy-accounting-c.js'));
    assert.ok(worker.includes('lazy-pos-b.js'));
    assert.ok(!worker.includes('user-data.json'));
    assert.match(worker, /premier-app-shell-v2-[a-f0-9]{16}/);
    assert.ok(!worker.includes('__PREMIER_BUILD_ASSETS__'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('offline bundle refuses missing markers and invalid asset URLs', () => {
  assert.throws(() => renderOfflineWorker('broken', ['/assets/app.js']), /BUILD_MARKERS_MISSING/);
  assert.throws(() => renderOfflineWorker(template, ['https://remote.test/secret.js']), /INVALID_BUILD_ASSETS/);
  assert.throws(() => renderOfflineWorker(template, ['/rest/v1/products.js']), /INVALID_BUILD_ASSETS/);
});

test('offline cache key changes when a lazy route bundle changes', () => {
  const first = renderOfflineWorker(template, ['/assets/index-a.js']);
  const next = renderOfflineWorker(template, ['/assets/index-b.js']);
  assert.notEqual(first, next);
});
