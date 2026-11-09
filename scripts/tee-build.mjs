/** Bind a clean server build to its exact inputs before it can be bundled. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const TEE_BUILD_RECEIPT = 'artifacts/tee-build.json';
const compileArgs = ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'];
const sha = value => createHash('sha256').update(value).digest('hex');

function fileTree(root, paths) {
  const files = [];
  function visit(path) {
    const full = join(root, path), stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw Error('TEE_BUILD_SYMLINK: ' + path);
    if (stat.isDirectory()) for (const name of readdirSync(full).sort()) visit(path + '/' + name);
    else if (stat.isFile()) files.push({ path, sha256: sha(readFileSync(full)) });
    else throw Error('TEE_BUILD_FILE_TYPE: ' + path);
  }
  for (const path of paths) visit(path);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function teeBuildInputs(root) {
  return fileTree(root, ['src', 'fixtures', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', '.node-version']);
}

// The build host is a trusted input. This receipt detects stale/mixed artifacts;
// it is not a signature, an independent compiler proof or hardware attestation.
export function createTeeBuildReceipt(root, inputs = teeBuildInputs(root)) {
  const files = fileTree(root, ['dist/server']);
  if (!files.some(file => file.path === 'dist/server/tee/index.js')) throw Error('TEE_BUILD_ENTRYPOINT');
  return { format: 'neslos-tee-build-v1', status: 'built', generatedAt: new Date().toISOString(),
    nodeVersion: process.version, compilerVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies.typescript,
    compileArgs, inputsSha256: sha(JSON.stringify(inputs)), files, outputsSha256: sha(JSON.stringify(files)) };
}

export function validateTeeBuild(root) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(join(root, TEE_BUILD_RECEIPT), 'utf8')); }
  catch { throw Error('TEE_BUILD_RECEIPT_REQUIRED: run npm run build in this workspace.'); }
  if (receipt?.format !== 'neslos-tee-build-v1' || receipt.status !== 'built') throw Error('TEE_BUILD_NOT_SUCCESSFUL');
  const expected = createTeeBuildReceipt(root);
  if (receipt.nodeVersion !== 'v' + readFileSync(join(root, '.node-version'), 'utf8').trim()
    || receipt.compilerVersion !== expected.compilerVersion || JSON.stringify(receipt.compileArgs) !== JSON.stringify(compileArgs)
    || receipt.inputsSha256 !== expected.inputsSha256) throw Error('TEE_BUILD_INPUTS_CHANGED: rebuild before bundling.');
  if (receipt.outputsSha256 !== expected.outputsSha256 || JSON.stringify(receipt.files) !== JSON.stringify(expected.files)) {
    throw Error('TEE_BUILD_OUTPUTS_CHANGED: compiled files were changed, added or removed; rebuild before bundling.');
  }
  return receipt;
}

export function buildTee(root = fileURLToPath(new URL('..', import.meta.url))) {
  root = realpathSync(root);
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  const receiptPath = join(root, TEE_BUILD_RECEIPT);
  writeFileSync(receiptPath, JSON.stringify({ format: 'neslos-tee-build-v1', status: 'building' }) + '\n');
  try {
    if (process.version !== 'v' + readFileSync(join(root, '.node-version'), 'utf8').trim()) throw Error('TEE_BUILD_NODE_VERSION');
    const inputs = teeBuildInputs(root), pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const compiler = JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8'));
    if (compiler.version !== pkg.devDependencies.typescript) throw Error('TEE_BUILD_COMPILER_VERSION: run npm ci.');
    // Delete only this build's generated directory, after refusing redirected paths.
    for (const path of ['dist', 'dist/server']) if (existsSync(join(root, path)) && lstatSync(join(root, path)).isSymbolicLink()) throw Error('TEE_BUILD_SYMLINK: ' + path);
    rmSync(join(root, 'dist/server'), { recursive: true, force: true });
    const result = spawnSync(process.execPath, compileArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw Error('TEE_BUILD_COMPILATION_FAILED');
    if (JSON.stringify(inputs) !== JSON.stringify(teeBuildInputs(root))) throw Error('TEE_BUILD_INPUTS_CHANGED_DURING_BUILD');
    const receipt = createTeeBuildReceipt(root, inputs);
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } catch (error) {
    writeFileSync(receiptPath, JSON.stringify({ format: 'neslos-tee-build-v1', status: 'failed' }) + '\n');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const receipt = buildTee();
  console.log(JSON.stringify({ teeBuild: 'passed', inputsSha256: receipt.inputsSha256, outputsSha256: receipt.outputsSha256 }));
}
