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

interface BundleFile { path: string; content: string }
interface Service { command: string[]; environment?: Record<string, string>; read_only: boolean; user: string; volumes: string[]; cap_drop: string[] }

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

it('authenticates inline bootstrap, application and lock bytes before launch', async () => {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), 'neslos-inline-bundle-test-'));
  const sha = (value: string | Uint8Array) => crypto.createHash('sha256').update(value).digest('hex');
  try {
    // Tiny compiled fixture keeps this test independent of a pre-existing dist build.
    await mkdir(path.join(directory, 'dist/server/tee'), { recursive: true });
    await mkdir(path.join(directory, 'fixtures'));
    await mkdir(path.join(directory, '.private'));
    await writeFile(path.join(directory, 'dist/server/tee/index.js'), 'export const fixture = true;\n');
    await writeFile(path.join(directory, 'dist/server/tee/index.js.map'), 'excluded source map');
    await writeFile(path.join(directory, 'fixtures/rhea-2026-11-01.json'), '{}');
    await writeFile(path.join(directory, '.env'), 'EXCLUDED_SECRET=fixture-sensitive-value');
    await writeFile(path.join(directory, '.private/credentials.json'), '{"secret":"fixture-sensitive-value"}');
    for (const name of ['package.json', 'package-lock.json']) {
      await writeFile(path.join(directory, name), await readFile(path.join(repository, name)));
    }
    const out = path.join(directory, 'bundle');
    const generated = spawnSync(process.execPath, [path.join(repository, 'scripts/tee-inline-bundle.mjs'), '--out', out], {
      cwd: directory, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, NEARAI_API_KEY: 'fixture-sensitive-value' },
    });
    expect(generated.status, generated.stderr).toBe(0);
    const composeText = await readFile(path.join(out, 'compose.yaml'), 'utf8');
    const compose = YAML.parse(composeText) as { services: { setup: Service; neslos: Service } };
    const manifest = JSON.parse(await readFile(path.join(out, 'deployment.json'), 'utf8')) as {
      composeSha256: string; bundleSha256: string; fileCount: number; files: { path: string; sha256: string }[];
    };
    const setup = compose.services.setup.command;
    const runtime = compose.services.neslos;
    const payload = Buffer.from(setup.slice(3).join(''), 'base64');
    const uncompressed = zlib.gunzipSync(payload).toString('utf8');
    const files = JSON.parse(uncompressed) as BundleFile[];
    expect(sha(composeText)).toBe(manifest.composeSha256);
    expect(sha(payload)).toBe(manifest.bundleSha256);
    expect(files).toHaveLength(manifest.fileCount);
    expect(new Set(files.map(file => file.path)).size).toBe(files.length);
    expect(files.some(file => /(^|\/)\.(env|private)|\.(map|ts)$/.test(file.path))).toBe(false);
    expect(uncompressed + composeText).not.toContain('fixture-sensitive-value');
    for (const file of files) expect(sha(Buffer.from(file.content, 'base64'))).toBe(manifest.files.find(row => row.path === file.path)?.sha256);
    const lock = JSON.parse(Buffer.from(files.find(file => file.path === 'package-lock.json')!.content, 'base64').toString('utf8')) as {
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
    expect(Array.from(installed.npmArgs!)).toEqual(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    const corrupted = Buffer.from(payload); corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    expect(() => bootstrap([corrupted.toString('base64')])).toThrow(/BUNDLE_HASH/);

    // Instrument only the final launch; this test executes no TEE or package install.
    const launch = "import('./dist/server/tee/index.js');";
    expect(runtime.command[2]!.endsWith(launch)).toBe(true);
    const verifier = runtime.command[2]!.slice(0, -launch.length) + 'globalThis.launchReached = true;';
    function verify(change?: (disk: Map<string, Buffer>, symlinks: Set<string>) => void) {
      const disk = new Map<string, Buffer>(files.map(file => [file.path, Buffer.from(file.content, 'base64')]));
      const symlinks = new Set<string>(); change?.(disk, symlinks);
      const context: { require: (name: string) => unknown; launchReached?: boolean } = {
        require(name: string) { return name === 'node:crypto' ? crypto : {
          lstatSync(name: string) { if (!disk.has(name)) throw new Error('ENOENT'); return { isFile: () => !symlinks.has(name) }; },
          readFileSync(name: string) { return disk.get(name); },
        }; },
      };
      vm.runInNewContext(verifier, context);
      expect(context.launchReached).toBe(true);
    }
    verify();
    verify(disk => { disk.set('.verify.cjs', Buffer.from('throw Error("UNTRUSTED")')); });
    expect(() => verify(disk => { disk.set('dist/server/tee/index.js', Buffer.from('tampered')); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.set('package-lock.json', Buffer.from('{}')); })).toThrow(/APP_INTEGRITY/);
    expect(() => verify(disk => { disk.delete('package-lock.json'); })).toThrow(/ENOENT/);
    expect(() => verify((_disk, symlinks) => { symlinks.add('dist/server/tee/index.js'); })).toThrow(/APP_INTEGRITY/);

    // An oversized bundle must stop locally before writing a deployable artifact.
    await writeFile(path.join(directory, 'dist/server/oversized.js'), `export const fixture = '${crypto.randomBytes(350000).toString('base64')}';`);
    const oversizedOut = path.join(directory, 'oversized-bundle');
    const oversized = spawnSync(process.execPath, [path.join(repository, 'scripts/tee-inline-bundle.mjs'), '--out', oversizedOut], { cwd: directory, encoding: 'utf8', windowsHide: true });
    expect(oversized.status).not.toBe(0);
    expect(oversized.stderr).toContain('PHALA_COMPOSE_PAYLOAD_TOO_LARGE');
    await expect(readFile(path.join(oversizedOut, 'compose.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(oversizedOut, 'deployment.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    assert.ok(path.basename(directory).startsWith('neslos-inline-bundle-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
