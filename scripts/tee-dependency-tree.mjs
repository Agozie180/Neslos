import { createHash } from 'node:crypto';

export const TEE_NODE_IMAGE = 'node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c';
export const TEE_NPM_ARGS = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];

/** Self-contained so the same algorithm can be embedded in measured startup. */
export function hashDependencyTree(root, fs, crypto) {
  if (!fs.lstatSync(root).isDirectory()) throw Error('DEPENDENCY_TREE_ROOT');
  const realRoot = fs.realpathSync(root).replaceAll('\\', '/');
  const hash = crypto.createHash('sha256').update('neslos-node-modules-v1\n');
  let fileCount = 0, symlinkCount = 0, directoryCount = 0, bytes = 0, entries = 0;
  function walk(relative, depth) {
    if (depth > 64) throw Error('DEPENDENCY_TREE_LIMIT');
    for (const name of fs.readdirSync(relative ? root + '/' + relative : root).sort()) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || ++entries > 100000) throw Error('DEPENDENCY_TREE_LIMIT');
      const path = relative ? relative + '/' + name : name, full = root + '/' + path, stat = fs.lstatSync(full);
      let record;
      if (stat.isSymbolicLink()) {
        // Authenticate link text and require its target inside the checked tree.
        // Never hash or trust a file outside the application dependency volume.
        if (!fs.realpathSync(full).replaceAll('\\', '/').startsWith(realRoot + '/')) throw Error('DEPENDENCY_TREE_EXTERNAL_LINK');
        record = ['link', path, fs.readlinkSync(full)]; symlinkCount++;
      } else if (stat.isDirectory()) {
        record = ['directory', path]; directoryCount++;
      } else if (stat.isFile()) {
        bytes += stat.size;
        if (!Number.isSafeInteger(bytes) || bytes > 512 * 1024 * 1024) throw Error('DEPENDENCY_TREE_LIMIT');
        record = ['file', path, stat.mode & 0o111, stat.size, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]; fileCount++;
      } else throw Error('DEPENDENCY_TREE_TYPE');
      hash.update(JSON.stringify(record) + '\n');
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, depth + 1);
    }
  }
  walk('', 0);
  return { sha256: hash.digest('hex'), fileCount, symlinkCount, directoryCount, bytes };
}

/** Reject extra module-resolution paths as well as changed expected files. */
export function verifyInstalledApplication(root, expectedFiles, expectedDependencies, fs, crypto, dependencyHash) {
  const files = new Map(expectedFiles), directories = new Set(['']);
  for (const name of files.keys()) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { directories.add(parts.join('/')); parts.pop(); }
  }
  let seen = 0;
  function walk(relative) {
    for (const name of fs.readdirSync(relative ? root + '/' + relative : root)) {
      const path = relative ? relative + '/' + name : name, full = root + '/' + path;
      if (path === 'node_modules') continue; // Checked separately in full below.
      const stat = fs.lstatSync(full);
      if (stat.isFile() && !stat.isSymbolicLink() && files.has(path)) {
        if (crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') !== files.get(path)) throw Error('APP_INTEGRITY');
        seen++;
      } else if (stat.isDirectory() && !stat.isSymbolicLink() && directories.has(path)) walk(path);
      else throw Error('APP_INTEGRITY');
    }
  }
  try {
    if (!fs.lstatSync(root).isDirectory()) throw Error('APP_INTEGRITY');
    walk('');
    if (seen !== files.size) throw Error('APP_INTEGRITY');
  } catch { throw Error('APP_INTEGRITY'); }
  try {
    if (dependencyHash(root + '/node_modules', fs, crypto).sha256 !== expectedDependencies) throw Error('DEPENDENCY_INTEGRITY');
  } catch { throw Error('DEPENDENCY_INTEGRITY'); }
}

export function validateDependencyManifest(manifest, packageBytes, lockBytes) {
  const sha = value => createHash('sha256').update(value).digest('hex');
  if (manifest?.format !== 'neslos-tee-dependencies-v1' || manifest.image !== TEE_NODE_IMAGE || manifest.platform !== 'linux/amd64' || manifest.nodeVersion !== 'v24.22.2' || manifest.npmVersion !== '11.19.1'
    || JSON.stringify(manifest.installArgs) !== JSON.stringify(TEE_NPM_ARGS)
    || manifest.packageSha256 !== sha(packageBytes) || manifest.lockSha256 !== sha(lockBytes)
    || typeof manifest.tree?.sha256 !== 'string' || manifest.tree.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(manifest.tree.sha256)) throw Error('DEPENDENCY_MANIFEST_MISMATCH');
  return manifest.tree.sha256;
}

export function installedApplicationGuard(files, dependencyHash) {
  if (typeof dependencyHash !== 'string' || dependencyHash.length !== 64 || !/^[a-f0-9]{64}$/.test(dependencyHash)) throw Error('DEPENDENCY_MANIFEST_MISMATCH');
  return '(' + verifyInstalledApplication.toString() + ')(".",' + JSON.stringify(files) + ',' + JSON.stringify(dependencyHash) + ',require("node:fs"),require("node:crypto"),(' + hashDependencyTree.toString() + '));';
}
