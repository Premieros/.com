import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'const BUILD_ASSETS = []; // __PREMIER_BUILD_ASSETS__';
export const CACHE_MARKER = "const CACHE_NAME = 'premier-app-shell-v2-dev'; // __PREMIER_BUILD_CACHE__";

// Keep only the Vite generated executable files needed for lazy route loading.
// Never pre-cache data, auth, user-specific JSON, uploads or Supabase responses.
export async function collectBuildAssets(distDir) {
  const dir = join(distDir, 'assets');
  const result = [];
  async function walk(folder) {
    for (const file of await readdir(folder, { withFileTypes: true })) {
      const absolute = join(folder, file.name);
      if (file.isDirectory()) {
        await walk(absolute);
      } else if (file.isFile() && /\.(?:js|css)$/.test(file.name)) {
        const size = (await stat(absolute)).size;
        if (size > 15 * 1024 * 1024) {
          throw new Error(`PREMIER_OFFLINE_OVERSIZED_CHUNK:${file.name}`);
        }
        result.push('/' + relative(distDir, absolute).split(sep).join('/'));
      }
    }
  }
  await walk(dir);
  result.sort();
  if (result.length === 0) throw new Error('PREMIER_OFFLINE_NO_BUILD_ASSETS');
  return result;
}

export function renderOfflineWorker(source, assets) {
  if (!source.includes(MARKER) || !source.includes(CACHE_MARKER)) {
    throw new Error('PREMIER_OFFLINE_BUILD_MARKERS_MISSING');
  }
  if (!Array.isArray(assets) || assets.length === 0 ||
      assets.some(a => !/^\/assets\/[A-Za-z0-9_./-]+\.(js|css)$/.test(a))) {
    throw new Error('PREMIER_OFFLINE_INVALID_BUILD_ASSETS');
  }
  const digest = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 16);
  return source.replace(MARKER, `const BUILD_ASSETS = ${JSON.stringify(assets)};`)
    .replace(CACHE_MARKER, `const CACHE_NAME = 'premier-app-shell-v2-${digest}';`);
}

export async function prepareOfflineWorker(distDir = 'dist') {
  const assets = await collectBuildAssets(distDir);
  const file = join(distDir, 'sw.js');
  const source = await readFile(file, 'utf8');
  await writeFile(file, renderOfflineWorker(source, assets));
  console.log(`Premier offline shell: precache ${assets.length} built route JS/CSS assets`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await prepareOfflineWorker(process.argv[2] || 'dist');
}
