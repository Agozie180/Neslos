/** Reproduce the production install in the exact pinned Linux base, without secrets. */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { TEE_NODE_IMAGE, TEE_NPM_ARGS, hashDependencyTree, validateDependencyManifest } from './tee-dependency-tree.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } }, strict: true });
if (!values.out) throw Error('Use --out NEW_MANIFEST_JSON. Docker must run Linux containers.');
const root = fileURLToPath(new URL('..', import.meta.url)), output = resolve(values.out);
if (existsSync(output)) throw Error('DEPENDENCY_MANIFEST_EXISTS');
const packageBytes = readFileSync(join(root, 'package.json')), lockBytes = readFileSync(join(root, 'package-lock.json'));
const local = join(root, '.local'); mkdirSync(local, { recursive: true });
const scratch = mkdtempSync(join(local, 'tee-dependency-input-'));
writeFileSync(join(scratch, 'package.json'), packageBytes, { flag: 'wx', mode: 0o600 });
writeFileSync(join(scratch, 'package-lock.json'), lockBytes, { flag: 'wx', mode: 0o600 });
const install = `const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
const pkg=fs.readFileSync('/input/package.json'),lock=fs.readFileSync('/input/package-lock.json');
fs.writeFileSync('/app/package.json',pkg);fs.writeFileSync('/app/package-lock.json',lock);
const result=cp.spawnSync('npm',${JSON.stringify(TEE_NPM_ARGS)},{cwd:'/app',stdio:'inherit',env:{...process.env,npm_config_cache:'/tmp/npm'}});if(result.status!==0)process.exit(1);
const npm=cp.spawnSync('npm',['--version'],{encoding:'utf8'});if(npm.status!==0)process.exit(1);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
console.log(JSON.stringify({format:'neslos-tee-dependencies-v1',image:${JSON.stringify(TEE_NODE_IMAGE)},platform:'linux/amd64',nodeVersion:process.version,npmVersion:npm.stdout.trim(),installArgs:${JSON.stringify(TEE_NPM_ARGS)},packageSha256:sha(pkg),lockSha256:sha(lock),tree:(${hashDependencyTree.toString()})('/app/node_modules',fs,crypto)}));`;
writeFileSync(join(scratch, 'install.cjs'), install, { flag: 'wx', mode: 0o600 });
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker', name = 'neslos-dependency-check-' + randomUUID();
let result;
try {
  result = spawnSync(docker, ['run', '--rm', '--name', name, '--platform', 'linux/amd64', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/app:rw,nosuid,size=1g', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m', '--mount', 'type=bind,source=' + scratch + ',target=/input,readonly', '--workdir', '/app', TEE_NODE_IMAGE, 'node', '/input/install.cjs'], { encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
} finally {
  // Only the uniquely named disposable container created above; no persistent volumes.
  spawnSync(docker, ['rm', '--force', name], { stdio: 'ignore', windowsHide: true, timeout: 30000 });
}
writeFileSync(join(scratch, 'install.log'), (result.stdout ?? '') + (result.stderr ?? ''), { flag: 'wx', mode: 0o600 });
if (result.error || result.status !== 0) throw Error('DEPENDENCY_INSTALL_FAILED: inspect ' + join(scratch, 'install.log'));
const manifest = JSON.parse(result.stdout.trim().split('\n').at(-1));
validateDependencyManifest(manifest, packageBytes, lockBytes);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ ...manifest, generatedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, ...manifest }, null, 2));
