import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import * as zlib from 'node:zlib';
import { expect, it } from 'vitest';
import YAML from 'yaml';

interface BundleFile { path: string; content: string; encoding?: 'utf8' | 'base64' }
interface Service { command: string[]; environment?: Record<string, string>; read_only: boolean; user: string; volumes: string[]; cap_drop: string[] }

const dependencyModule = '../scripts/tee-dependency-tree.mjs';
const { hashDependencyTree, TEE_NODE_IMAGE, TEE_NPM_ARGS } = await import(dependencyModule);
const buildModule = '../scripts/tee-build.mjs';
const { createTeeBuildReceipt, TEE_BUILD_RECEIPT } = await import(buildModule);
function virtualFileSystem(disk: Map<string, Buffer>, symlinks = new Set<string>()) {
  const clean = (name: string) => name.replace(/^\.\//, '').replace(/^\.$/, '');
  function directories() {
    const result = new Set(['', 'node_modules']);
    for (const name of disk.keys()) { const parts = name.split('/'); parts.pop(); while (parts.length) { result.add(parts.join('/')); parts.pop(); } }
    return result;
  }
  return {
    lstatSync(input: string) {
      const name = clean(input), isLink = symlinks.has(name), isFile = disk.has(name), isDirectory = directories().has(name);
      if (!isLink && !isFile && !isDirectory) throw Error('ENOENT');
      return { isFile: () => isFile && !isLink, isDirectory: () => isDirectory && !isLink, isSymbolicLink: () => isLink, size: disk.get(name)?.length ?? 0, mode: 0o644 };
    },
    readdirSync(input: string) {
      const name = clean(input), prefix = name ? name + '/' : '';
      return [...new Set([...disk.keys(), ...directories()].filter(p => p !== name && p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]!))];
    },
    readFileSync: (name: string) => disk.get(clean(name)),
    realpathSync: (name: string) => symlinks.has(clean(name)) ? '/outside' : '/fixture/' + clean(name),
    readlinkSync: () => '../../outside',
  };
}

it('enforces the official combined UTF-8 compose and pre-launch size boundary without disclosing content', async () => {
  const modulePath = '../scripts/phala-compose.mjs';
  const { assertPhalaComposePayloadSize, PHALA_MAX_COMPOSE_PAYLOAD_BYTES } = await import(modulePath);
  expect(PHALA_MAX_COMPOSE_PAYLOAD_BYTES).toBe(204800);
  expect(assertPhalaComposePayloadSize('a'.repeat(204800))).toBe(204800);
  expect(assertPhalaComposePayloadSize('a'.repeat(204799), 'b')).toBe(204800);
  expect(() => assertPhalaComposePayloadSize('a'.repeat(204800), 'b')).toThrow('PHALA_COMPOSE_PAYLOAD_TOO_LARGE');
  expect(() => assertPhalaComposePayloadSize('é'.repeat(102401))).toThrow('204802 UTF-8 bytes');
  try { assertPhalaComposePayloadSize('a'.repeat(204800), 'fixture-sensitive-script'); } catch (error) { expect(String(error)).not.toContain('fixture-sensitive-script'); }
});

it.each([false, true])('authenticates inline bootstrap, application and lock bytes before launch (compact: %s)', async compact => {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), 'neslos-inline-bundle-test-'));
  const sha = (value: string | Uint8Array) => crypto.createHash('sha256').update(value).digest('hex');
  try {
    // Tiny compiled fixture keeps this test independent of a pre-existing dist build.
    await mkdir(path.join(directory, 'dist/server/tee'), { recursive: true });
    await mkdir(path.join(directory, 'fixtures'));
    await mkdir(path.join(directory, '.private'));
    await mkdir(path.join(directory, 'src'));
    await mkdir(path.join(directory, 'artifacts'));
    const sourceFixture = Buffer.from("export const fixture = 'Lagos — café 🧪';\n");
    const binaryFixture = Buffer.from([0, 255, 192, 175, 237, 160, 128, 13, 10]);
    await writeFile(path.join(directory, 'dist/server/tee/index.js'), sourceFixture);
    await writeFile(path.join(directory, 'dist/server/tee/index.js.map'), 'excluded source map');
    await writeFile(path.join(directory, 'fixtures/rhea-2026-11-01.json'), '{}');
    await writeFile(path.join(directory, 'fixtures/binary.bin'), binaryFixture);
    await writeFile(path.join(directory, '.env'), 'EXCLUDED_SECRET=fixture-sensitive-value');
    await writeFile(path.join(directory, '.private/credentials.json'), '{"secret":"fixture-sensitive-value"}');
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', '.node-version']) {
      await writeFile(path.join(directory, name), await readFile(path.join(repository, name)));
    }
    await writeFile(path.join(directory, TEE_BUILD_RECEIPT), JSON.stringify(createTeeBuildReceipt(directory)));
    const dependencyFixture = new Map([['node_modules/fixture/index.js', Buffer.from('export const dependency = true;\n')]]);
    const dependenciesPath = path.join(directory, 'dependencies.json');
    await writeFile(dependenciesPath, JSON.stringify({ format: 'neslos-tee-dependencies-v1', image: TEE_NODE_IMAGE, platform: 'linux/amd64', nodeVersion: 'v24.22.2', npmVersion: '11.19.1', installArgs: TEE_NPM_ARGS,
      packageSha256: sha(await readFile(path.join(repository, 'package.json'))), lockSha256: sha(await readFile(path.join(repository, 'package-lock.json'))), tree: hashDependencyTree('node_modules', virtualFileSystem(dependencyFixture), crypto) }));
    const out = path.join(directory, 'bundle');
    const options = ['--dependencies', dependenciesPath, ...(compact ? ['--compact', '--testnet-vault', 'vault.neslos.testnet', '--attestation-only'] : [])];
    const generated = spawnSync(process.execPath, [path.join(repository, 'scripts/tee-inline-bundle.mjs'), '--out', out, ...options], {
      cwd: directory, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, NEARAI_API_KEY: 'fixture-sensitive-value' },
    });
    expect(generated.status, generated.stderr).toBe(0);
    const composeText = await readFile(path.join(out, 'compose.yaml'), 'utf8');
    const compose = YAML.parse(composeText) as { services: { setup: Service; neslos: Service } };
    const manifest = JSON.parse(await readFile(path.join(out, 'deployment.json'), 'utf8')) as {
      composeSha256: string; bundleSha256: string; fileCount: number; compression: string; files: { path: string; sha256: string }[];
    };
    const setup = compose.services.setup.command;
    const runtime = compose.services.neslos;
    const payload = Buffer.from(setup.slice(3).join(''), 'base64');
    const uncompressed = (compact ? zlib.brotliDecompressSync(payload) : zlib.gunzipSync(payload)).toString('utf8');
    const files = JSON.parse(uncompressed) as BundleFile[];
    const fileBytes = (file: BundleFile) => Buffer.from(file.content, file.encoding ?? 'base64');
    expect(manifest.compression).toBe(compact ? 'brotli' : 'gzip');
    expect(sha(composeText)).toBe(manifest.composeSha256);
    expect(sha(payload)).toBe(manifest.bundleSha256);
    expect(files).toHaveLength(manifest.fileCount);
    expect(new Set(files.map(file => file.path)).size).toBe(files.length);
    expect(files.some(file => /(^|\/)\.(env|private)|\.(map|ts)$/.test(file.path))).toBe(false);
    expect(uncompressed + composeText).not.toContain('fixture-sensitive-value');
    for (const file of files) expect(sha(fileBytes(file))).toBe(manifest.files.find(row => row.path === file.path)?.sha256);
    const lockBytes = fileBytes(files.find(file => file.path === 'package-lock.json')!);
    expect(lockBytes).toEqual(await readFile(path.join(repository, 'package-lock.json')));
    const lock = JSON.parse(lockBytes.toString('utf8')) as {
      packages: Record<string, { dev?: boolean; link?: boolean; resolved?: string; integrity?: string }>;
    };
    for (const [name, entry] of Object.entries(lock.packages).filter(([name, entry]) => name && !entry.dev)) {
      expect(entry.link, name).not.toBe(true);
      expect(entry.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, name).toMatch(/^sha512-[A-Za-z0-9+/=]+$/);
    }
    expect(compose.services.setup.environment).toBeUndefined();
    expect(runtime.read_only).toBe(true);
    expect(runtime.user).toBe('1000:1000');
    expect(runtime.volumes).toContain('neslos-app:/app:ro');
    expect(runtime.cap_drop).toEqual(['ALL']);
    expect(runtime.command.slice(0, 2)).toEqual(['node', '-e']);
    expect(runtime.command[2]).not.toContain('.verify.cjs');
    if (compact) {
      expect(manifest).toMatchObject({ target: { network: 'testnet', vault: 'vault.neslos.testnet' }, runtimeMode: 'attestation-only' });
      expect(runtime.environment).toMatchObject({ NESLOS_RUNTIME_MODE: 'attestation-only', NESLOS_NETWORK: 'testnet', NESLOS_VAULT_ACCOUNT: 'vault.neslos.testnet', NEARAI_API_KEY: '', NESLOS_OWNER_TOKEN: '', NESLOS_INFERENCE_POLICY_JSON: '' });
      expect(composeText).not.toContain('${NESLOS_');
      expect(files.find(f => f.path === 'dist/server/tee/index.js')?.encoding).toBe('utf8');
      expect(files.find(f => f.path === 'fixtures/binary.bin')?.encoding).toBe('base64');
    }

    function bootstrap(chunks: string[]) {
      const written = new Map<string, Buffer>(); let npmArgs: string[] | undefined;
      const modules: Record<string, unknown> = {
        'node:fs': { mkdirSync() {}, chownSync() {}, writeFileSync(name: string, value: Uint8Array) { written.set(name, Buffer.from(value)); } },
        'node:zlib': zlib, 'node:crypto': crypto, 'node:path': path,
        'node:child_process': { spawnSync(command: string, args: string[]) { assert.equal(command, 'npm'); npmArgs = args; return { status: 0 }; } },
      };
      vm.runInNewContext(setup[2]!, {
        Buffer, console: { log() {} }, require: (name: string) => modules[name],
        process: { argv: ['node', ...chunks], env: {}, exit(code: number) { throw new Error('EXIT:' + code); } },
      });
      return { written, npmArgs };
    }
    const installed = bootstrap(setup.slice(3));
    expect(installed.written.size).toBe(files.length);
    expect(installed.written.get('/app/dist/server/tee/index.js')).toEqual(sourceFixture);
    expect(installed.written.get('/app/fixtures/binary.bin')).toEqual(binaryFixture);
    expect(installed.written.get('/app/package-lock.json')).toEqual(lockBytes);
    expect(Array.from(installed.npmArgs!)).toEqual(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    const corrupted = Buffer.from(payload); corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    expect(() => bootstrap([corrupted.toString('base64')])).toThrow(/BUNDLE_HASH/);

    // Instrument only the final launch; this test executes no TEE or package install.
    const launch = "import('./dist/server/tee/index.js');";
    expect(runtime.command[2]!.endsWith(launch)).toBe(true);
    const verifier = runtime.command[2]!.slice(0, -launch.length) + 'globalThis.launchReached = true;';
    function verify(change?: (disk: Map<string, Buffer>, symlinks: Set<string>) => void) {
      const disk = new Map<string, Buffer>([...files.map(file => [file.path, fileBytes(file)] as const), ...dependencyFixture]);
      const symlinks = new Set<string>(); change?.(disk, symlinks);
      const context: { require: (name: string) => unknown; launchReached?: boolean } = {
        require(name: string) { return name === 'node:crypto' ? crypto : virtualFileSystem(disk, symlinks); },
      };
      vm.runInNewContext(verifier, context);
      expect(context.launchReached).toBe(true);
    }
    verify();
    expect(() => verify(disk => { disk.set('.verify.cjs', Buffer.from('throw Error("UNTRUSTED")')); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.set('dist/server/tee/index.js', Buffer.from('tampered')); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.set('package-lock.json', Buffer.from('{}')); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.delete('package-lock.json'); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify((_disk, symlinks) => { symlinks.add('dist/server/tee/index.js'); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.set('node_modules/fixture/index.js', Buffer.from('tampered dependency')); })).toThrow(/DEPENDENCY_INTEGRITY/);
    expect(() => verify(disk => { disk.delete('node_modules/fixture/index.js'); })).toThrow(/DEPENDENCY_INTEGRITY/);
    expect(() => verify(disk => { disk.set('node_modules/extra.js', Buffer.from('injected dependency')); })).toThrow(/DEPENDENCY_INTEGRITY/);
    expect(() => verify((_disk, symlinks) => { symlinks.add('node_modules'); })).toThrow(/DEPENDENCY_INTEGRITY/);
    expect(() => verify(disk => { disk.set('dist/server/node_modules/fixture/index.js', Buffer.from('shadowed dependency')); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.set('dist/server/package.json', Buffer.from('{"type":"commonjs"}')); })).toThrow(/APP_INTEGRITY/);

    // A missing or stale install receipt must fail before producing a bundle.
    for (const stale of [false, true]) {
      const rejectedOut = path.join(directory, stale ? 'stale-receipt' : 'missing-receipt');
      if (stale) await writeFile(path.join(directory, 'package.json'), '{}');
      const rejected = spawnSync(process.execPath, [path.join(repository, 'scripts/tee-inline-bundle.mjs'), '--out', rejectedOut, ...(stale ? options : [])], { cwd: directory, encoding: 'utf8', windowsHide: true });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain(stale ? 'DEPENDENCY_MANIFEST_MISMATCH' : 'DEPENDENCY_MANIFEST_REQUIRED');
      await expect(readFile(path.join(rejectedOut, 'compose.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await writeFile(path.join(directory, 'package.json'), await readFile(path.join(repository, 'package.json')));

    // An oversized bundle must stop locally before writing a deployable artifact.
    await writeFile(path.join(directory, 'dist/server/oversized.js'), `export const fixture = '${crypto.randomBytes(350000).toString('base64')}';`);
    await writeFile(path.join(directory, TEE_BUILD_RECEIPT), JSON.stringify(createTeeBuildReceipt(directory)));
    const oversizedOut = path.join(directory, 'oversized-bundle');
    const oversized = spawnSync(process.execPath, [path.join(repository, 'scripts/tee-inline-bundle.mjs'), '--out', oversizedOut, ...options], { cwd: directory, encoding: 'utf8', windowsHide: true });
    expect(oversized.status).not.toBe(0);
    expect(oversized.stderr).toContain('PHALA_COMPOSE_PAYLOAD_TOO_LARGE');
    await expect(readFile(path.join(oversizedOut, 'compose.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(oversizedOut, 'deployment.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    assert.ok(path.basename(directory).startsWith('neslos-inline-bundle-test-'));
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

it.each(['vault.neslos.near', 'vault..neslos.testnet', 'vault.neslos.testnet\n', 'x'.repeat(57) + '.testnet'])('rejects invalid inline testnet target %j before writing output', async vault => {
  const directory = await mkdtemp(path.join(tmpdir(), 'neslos-inline-target-test-'));
  try {
    const out = path.join(directory, 'bundle');
    const result = spawnSync(process.execPath, [path.resolve('scripts/tee-inline-bundle.mjs'), '--out', out, '--compact', '--testnet-vault', vault], { cwd: directory, encoding: 'utf8', windowsHide: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('TESTNET_VAULT_REQUIRED');
    await expect(readFile(path.join(out, 'compose.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    assert.ok(path.basename(directory).startsWith('neslos-inline-target-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
