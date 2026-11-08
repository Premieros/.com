'use strict';

/**
 * Read-only static host for the exact UI bundled inside the Windows installer.
 * Binds exclusively to 127.0.0.1 on a stable port. No proxy, DB, API, or
 * internet fallback is provided here. Financial offline operations remain
 * separately gated until the local transaction/sync engine is implemented.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { promises: files } = fs;

const HOST = '127.0.0.1';
// Stable origin is essential: a new random port would hide IndexedDB and
// queued offline sales on every application restart.
const DEFAULT_LOCAL_PORT = 43187;
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
});

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function decodeRequestPath(rawUrl) {
  const rawPath = String(rawUrl || '').split(/[?#]/, 1)[0];
  const pathname = decodeURIComponent(rawPath);
  if (!pathname.startsWith('/') || /[\u0000-\u001f\\]/.test(pathname)) {
    throw Object.assign(new Error('INVALID_LOCAL_PATH'), { status: 400 });
  }
  if (pathname.split('/').includes('..')) {
    throw Object.assign(new Error('LOCAL_PATH_TRAVERSAL'), { status: 403 });
  }
  return pathname;
}

function respond(res, status, body = '') {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function resolveStaticFile(root, pathname, acceptHtml) {
  const relative = pathname.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative || 'index.html');
  if (!isInsideRoot(root, candidate)) return { status: 403 };

  try {
    const real = await files.realpath(candidate);
    if (!isInsideRoot(root, real)) return { status: 403 };
    const stat = await files.stat(real);
    if (stat.isFile() && MIME[path.extname(real).toLowerCase()]) return { file: real };
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }

  // Support React BrowserRouter deep links without ever returning index.html
  // for missing JS/CSS/assets or API calls.
  if (acceptHtml && !path.extname(relative) && !relative.startsWith('assets/')
      && !relative.startsWith('api/')) {
    return { file: path.join(root, 'index.html') };
  }
  return { status: 404 };
}

async function startLocalAppServer({ distDir, port = DEFAULT_LOCAL_PORT } = {}) {
  if (typeof distDir !== 'string' || !distDir.trim()) {
    throw new Error('PREMIER_LOCAL_UI_BUILD_REQUIRED: dist directory not provided');
  }
  let root;
  try {
    root = await files.realpath(distDir);
    const index = await files.stat(path.join(root, 'index.html'));
    if (!index.isFile()) throw new Error('missing index.html');
  } catch {
    // Fail closed. Do not silently load a different, possibly stale web app.
    throw new Error('PREMIER_LOCAL_UI_BUILD_REQUIRED: bundled dist/index.html not found');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address();
      const expectedHost = HOST + ':' + address.port;
      if (req.headers.host !== expectedHost) return respond(res, 403, 'FORBIDDEN_HOST');
      if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, 'METHOD_NOT_ALLOWED');
      const pathname = decodeRequestPath(req.url);
      const acceptHtml = pathname === '/' || String(req.headers.accept || '').includes('text/html');
      const resolved = await resolveStaticFile(root, pathname, acceptHtml);
      if (!resolved.file) return respond(res, resolved.status, 'NOT_FOUND');

      const body = await files.readFile(resolved.file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved.file).toLowerCase()],
        'Content-Length': body.length,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
    } catch (error) {
      const status = error instanceof URIError ? 400 : error.status || 500;
      respond(res, status, 'LOCAL_UI_REQUEST_FAILED');
    }
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  }

  const boundPort = server.address().port;
  return {
    url: 'http://' + HOST + ':' + boundPort + '/',
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

module.exports = { DEFAULT_LOCAL_PORT, startLocalAppServer };
