'use strict';

// Smoke test against the real Vite production output, with no external network.
const assert = require('node:assert/strict');
const path = require('node:path');
const { startLocalAppServer } = require('./localAppServer.cjs');

async function main() {
  const app = await startLocalAppServer({
    distDir: path.join(__dirname, '..', 'dist'),
    port: 0, // Isolated test port; installed application uses fixed 43187.
  });
  try {
    const response = await fetch(app.url);
    assert.equal(response.status, 200, 'bundled index must load');
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/, 'React root must be bundled');
    const source = html.match(/<script[^>]+src="([^"]+\.js)"/);
    assert.ok(source, 'Vite JavaScript entry must be referenced');

    const script = await fetch(new URL(source[1], app.url));
    assert.equal(script.status, 200, 'bundled entry script must load');
    assert.match(script.headers.get('content-type'), /^text\/javascript/);
    assert.ok((await script.text()).length > 100, 'entry script must be populated');

    const route = await fetch(new URL('/pos', app.url), {
      headers: { Accept: 'text/html' },
    });
    assert.equal(route.status, 200, 'deep-link reload must serve React shell');
    assert.match(await route.text(), /<div id="root"><\/div>/);

    const missing = await fetch(new URL('/assets/missing.js', app.url));
    assert.equal(missing.status, 404, 'missing assets cannot silently serve HTML');

    console.log('Premier bundled desktop UI smoke passed: index, JS, routes and assets.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
