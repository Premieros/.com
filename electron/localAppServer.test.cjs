'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { DEFAULT_LOCAL_PORT, startLocalAppServer } = require('./localAppServer.cjs');

let temp;
let baseUrl;
let local;
let root;

function request(rawPath, { method = 'GET', host, accept = '*/*' } = {}) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: Number(url.port),
      path: rawPath,
      method,
      headers: {
        Host: host || url.host,
        Accept: accept,
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'premier-desktop-ui-test-'));
  root = path.join(temp, 'dist');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Premier Local</title><div id="root"></div>');
  await fs.writeFile(path.join(root, 'assets', 'index.js'), 'console.log("bundled-only");');
  await fs.writeFile(path.join(temp, 'private.txt'), 'never expose this file');
  local = await startLocalAppServer({ distDir: root, port: 0 });
  baseUrl = local.url;
});

after(async () => {
  if (local) await local.close();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

test('stable production origin preserves IndexedDB across app restarts', () => {
  assert.equal(DEFAULT_LOCAL_PORT, 43187);
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.ok(!baseUrl.includes('github.io') && !baseUrl.includes('vercel.app'));
});

test('serves bundled index and JS without any remote source', async () => {
  const rootResponse = await request('/', { accept: 'text/html' });
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers['content-type'], /^text\/html/);
  assert.match(rootResponse.body, /Premier Local/);
  const js = await request('/assets/index.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /^text\/javascript/);
  assert.equal(js.body, 'console.log("bundled-only");');
  assert.equal(rootResponse.headers['x-content-type-options'], 'nosniff');
});

test('supports React BrowserRouter navigation and reloads, not arbitrary fetch fallbacks', async () => {
  const pos = await request('/pos/example-order', { accept: 'text/html' });
  assert.equal(pos.status, 200);
  assert.match(pos.body, /Premier Local/);
  const api = await request('/api/orders', { accept: 'application/json' });
  assert.equal(api.status, 404);
  const missingAsset = await request('/assets/missing.js', { accept: 'text/html' });
  assert.equal(missingAsset.status, 404);
  const missingJson = await request('/missing.json', { accept: 'text/html' });
  assert.equal(missingJson.status, 404);
});

test('blocks DNS rebinding, non-read-only methods, and file traversal', async () => {
  assert.equal((await request('/assets/index.js', { host: 'attacker.example' })).status, 403);
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  assert.equal((await request('/%2e%2e/private.txt', { accept: 'text/html' })).status, 403);
  assert.equal((await request('/%5cprivate.txt', { accept: 'text/html' })).status, 400);
  assert.equal((await request('/%GG', { accept: 'text/html' })).status, 400);
  assert.equal((await request('/private.txt')).status, 404);
});

test('HEAD returns headers but no bytes', async () => {
  const r = await request('/assets/index.js', { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.body, '');
  assert.ok(Number(r.headers['content-length']) > 0);
});

test('will not initialize without a bundled build', async () => {
  await assert.rejects(() => startLocalAppServer({
    distDir: path.join(temp, 'not-built'),
    port: 0,
  }), /PREMIER_LOCAL_UI_BUILD_REQUIRED/);
});

test('blocks a symlink outside the bundled UI directory', { skip: process.platform === 'win32' }, async () => {
  await fs.symlink(path.join(temp, 'private.txt'), path.join(root, 'assets', 'escape.txt'));
  const r = await request('/assets/escape.txt');
  assert.equal(r.status, 403);
  assert.doesNotMatch(r.body, /never expose this file/);
});

test('Windows Electron entry never silently loads the hosted web UI', async () => {
  const main = await fs.readFile(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.match(main, /startLocalAppServer/);
  assert.doesNotMatch(main, /premieros\.github\.io/);
  assert.doesNotMatch(main, /loadFile\(localIndex\)/);
  assert.doesNotMatch(main, /process\.env\.POS_APP_URL/);
});
