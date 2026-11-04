import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceIdentity(root = process.env.NESLOS_SOURCE_ROOT ?? process.cwd()) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (revision.status !== 0 || listing.status !== 0) return { revision: null, treeSha256: null };
  const digest = createHash('sha256');
  const paths = [...new Set(listing.stdout.split('\0').filter(p => /^(src\/|scripts\/|tests\/|contracts\/|deploy\/tee\/|package(?:-lock)?\.json$|.*config\.[^/]+$|rust-toolchain\.toml$|Dockerfile|\.dockerignore$|\.node-version$)/.test(p)))].sort();
  for (const path of paths) {
    const full = resolve(root, path);
    if (existsSync(full) && lstatSync(full).isFile()) digest.update(path + '\0').update(readFileSync(full)).update('\0');
  }
  return { revision: revision.stdout.trim(), treeSha256: digest.digest('hex') };
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.pending', JSON.stringify(value, null, 2) + '\n');
  renameSync(path + '.pending', path);
}
export function startCheck(root, filename, command) {
  const started = Date.now();
  const initial = { runId: randomUUID(), startedAt: new Date(started).toISOString(), command, source: sourceIdentity(), success: false, status: 'running' };
  const path = resolve(root, 'artifacts', filename);
  writeJson(path, initial); // Invalidate any older success before executing the check.
  return (success, details = {}) => writeJson(path, { ...initial, ...details, success, status: success ? 'passed' : 'failed', generatedAt: new Date().toISOString(), elapsedMs: Date.now() - started });
}

function candidatePaths(root, task) {
  const patterns = {
    verify: /^(app-verification|unit-results)\.json$/,
    test: /^unit-results\.json$/,
    'test:browser': /^(browser-results\.json|neslos-[a-z-]+\.png)$/,
    'test:contract': /^(contract-(verification\.json|output\.log)|(?:policy_vault|neslos_test_token)(?:\.wasm|_abi\.(?:json|zst)))$/,
    'build:contract': /^(contract-(verification\.json|output\.log)|policy_vault(?:\.wasm|_abi\.(?:json|zst)))$/,
    'test:contract:unit': /^contract-(verification\.json|output\.log)$/,
  };
  if (task === 'testnet') return ['deploy/testnet.json', 'deploy/testnet-proof.json'];
  const pattern = patterns[task];
  if (!pattern || !existsSync(resolve(root, 'artifacts'))) return [];
  return readdirSync(resolve(root, 'artifacts')).filter(name => pattern.test(name)).map(name => 'artifacts/' + name);
}
export function snapshotEvidence(root, task) {
  const files = {};
  for (const path of candidatePaths(root, task)) {
    const full = resolve(root, path);
    if (existsSync(full) && lstatSync(full).isFile()) files[path] = hash(readFileSync(full));
  }
  return { task, files };
}
export function publishEvidence(root, destination, before) {
  const after = snapshotEvidence(root, before.task), copied = [];
  for (const [path, digest] of Object.entries(after.files)) {
    if (before.files[path] === digest) continue; // Never restore an unchanged cached result.
    mkdirSync(dirname(resolve(destination, path)), { recursive: true });
    copyFileSync(resolve(root, path), resolve(destination, path)); copied.push(path);
  }
  return copied;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, task, snapshot, destination, exitCode] = process.argv.slice(2);
  if (operation === 'snapshot') writeJson(snapshot, { ...snapshotEvidence(process.cwd(), task), runId: randomUUID(), startedAt: new Date().toISOString(), source: sourceIdentity() });
  else if (operation === 'publish') {
    const before = JSON.parse(readFileSync(snapshot, 'utf8'));
    if (before.task !== task) throw new Error('Evidence task mismatch.');
    const copied = publishEvidence(process.cwd(), destination, before);
    writeJson(resolve(destination, 'artifacts/wsl-run.json'), { runId: before.runId, task, source: before.source, startedAt: before.startedAt, finishedAt: new Date().toISOString(), exitCode: Number(exitCode), success: exitCode === '0', copied });
  } else throw new Error('Use snapshot or publish.');
}
