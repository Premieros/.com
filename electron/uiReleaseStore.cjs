'use strict';

// Offline-first UI release staging. NO network fetch, execution, or activation.
// A later, separately reviewed updater may feed these functions only bundles
// signed with a pinned Premier release key and approved by the local operator.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const ALLOWED = new Set([
  '.html','.js','.mjs','.css','.json','.svg','.png','.jpg','.jpeg',
  '.gif','.webp','.avif','.ico','.woff','.woff2','.ttf','.otf',
  '.wasm','.txt','.webmanifest',
]);

function fail(code) { throw new Error(code); }
function validRelative(name) {
  return typeof name === 'string' && name.length <= 240
    && !name.includes('\\') && !name.includes('\0')
    && !name.startsWith('/') && !name.includes('//')
    && name.split('/').every(part => part && part !== '.' && part !== '..')
    && /^[a-zA-Z0-9_./-]+$/.test(name)
    && ALLOWED.has(path.posix.extname(name));
}
function validateManifest(manifest) {
  if (!manifest || manifest.format !== 1
    || typeof manifest.releaseId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(manifest.releaseId)
    || manifest.releaseId === '.' || manifest.releaseId === '..'
    || !Array.isArray(manifest.files)
    || manifest.files.length < 1 || manifest.files.length > MAX_FILES) {
    fail('UI_RELEASE_MANIFEST_INVALID');
  }
  const names = new Set();
  let total = 0;
  for (const file of manifest.files) {
    if (!file || !validRelative(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.size)
      || file.size < 0 || file.size > MAX_FILE_BYTES
      || names.has(file.path.toLowerCase())) fail('UI_RELEASE_FILE_INVALID');
    names.add(file.path.toLowerCase());
    total += file.size;
    if (total > MAX_TOTAL_BYTES) fail('UI_RELEASE_TOO_LARGE');
  }
  if (!names.has('index.html')) fail('UI_RELEASE_INDEX_REQUIRED');
  return manifest;
}
function verifyManifest({manifestText,signatureBase64,publicKeyPem}) {
  if (typeof manifestText !== 'string' || manifestText.length > 500000
    || typeof signatureBase64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)
    || typeof publicKeyPem !== 'string') fail('UI_RELEASE_SIGNATURE_REQUIRED');
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch { fail('UI_RELEASE_MANIFEST_INVALID'); }
  validateManifest(manifest);
  const signature = Buffer.from(signatureBase64,'base64');
  let verified = false;
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64)
      fail('UI_RELEASE_SIGNATURE_INVALID');
    verified = crypto.verify(null,Buffer.from(manifestText,'utf8'),key,signature);
  } catch { fail('UI_RELEASE_SIGNATURE_INVALID'); }
  if (!verified) fail('UI_RELEASE_SIGNATURE_INVALID');
  return manifest;
}
async function verifyFiles(root,manifest) {
  const realRoot = await fsp.realpath(root);
  for (const file of manifest.files) {
    const candidate = path.resolve(realRoot,...file.path.split('/'));
    const rel = path.relative(realRoot,candidate);
    if (!rel || rel.startsWith('..'+path.sep) || path.isAbsolute(rel))
      fail('UI_RELEASE_PATH_INVALID');
    const stat = await fsp.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size)
      fail('UI_RELEASE_FILE_INVALID');
    const real = await fsp.realpath(candidate);
    const realRel = path.relative(realRoot,real);
    if (!realRel || realRel.startsWith('..'+path.sep) || path.isAbsolute(realRel))
      fail('UI_RELEASE_PATH_INVALID');
    // Reject symlinked ancestor folders, even when they point inside root.
    if (real !== candidate) fail('UI_RELEASE_PATH_INVALID');
    const digest = crypto.createHash('sha256')
      .update(await fsp.readFile(candidate)).digest('hex');
    if (digest !== file.sha256) fail('UI_RELEASE_HASH_MISMATCH');
  }
}

// Only STAGES a new immutable directory. Does not edit app bundle, IndexedDB,
// receipts, local SQLite or the active UI. Production activation is not enabled.
async function stageUiRelease({sourceDir,storeDir,manifestText,signatureBase64,publicKeyPem}) {
  const manifest = verifyManifest({manifestText,signatureBase64,publicKeyPem});
  if (!sourceDir || !storeDir) fail('UI_RELEASE_PATH_INVALID');
  await verifyFiles(sourceDir,manifest);
  await fsp.mkdir(storeDir,{recursive:true,mode:0o700});
  const destination = path.join(storeDir,manifest.releaseId);
  if (fs.existsSync(destination)) fail('UI_RELEASE_ALREADY_STAGED');
  const staging = path.join(storeDir,'.stage-'+crypto.randomUUID());
  await fsp.mkdir(staging,{mode:0o700});
  try {
    for (const file of manifest.files) {
      const source = path.join(sourceDir,...file.path.split('/'));
      const target = path.join(staging,...file.path.split('/'));
      await fsp.mkdir(path.dirname(target),{recursive:true});
      await fsp.copyFile(source,target,fs.constants.COPYFILE_EXCL);
    }
    await verifyFiles(staging,manifest);
    await fsp.writeFile(path.join(staging,'release-manifest.json'),manifestText,{flag:'wx',mode:0o600});
    await fsp.writeFile(path.join(staging,'release-signature.txt'),signatureBase64,{flag:'wx',mode:0o600});
    await fsp.rename(staging,destination);
    return Object.freeze({releaseId:manifest.releaseId,staged:true,activated:false});
  } catch(error) {
    await fsp.rm(staging,{force:true,recursive:true});
    throw error;
  }
}
module.exports = {validateManifest,verifyManifest,verifyFiles,stageUiRelease};
