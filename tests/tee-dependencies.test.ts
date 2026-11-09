import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { expect, it } from 'vitest';

const modulePath = '../scripts/tee-dependency-tree.mjs';
const { hashDependencyTree, validateDependencyManifest, TEE_NODE_IMAGE, TEE_NPM_ARGS } = await import(modulePath);

it('detects modified, missing, additional and hidden dependency bytes without depending on directory enumeration order', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'neslos-dependency-tree-'));
  try {
    fs.mkdirSync(join(directory, 'package'));
    fs.writeFileSync(join(directory, 'package/index.js'), 'export const value = "café";\n');
    fs.writeFileSync(join(directory, '.package-lock.json'), '{}');
    const original = hashDependencyTree(directory, fs, crypto);
    const reversed = { ...fs, readdirSync: (path: fs.PathLike) => fs.readdirSync(path).reverse() };
    expect(hashDependencyTree(directory, reversed, crypto)).toEqual(original);
    fs.writeFileSync(join(directory, 'package/index.js'), 'export const value = "evil";\n');
    expect(hashDependencyTree(directory, fs, crypto).sha256).not.toBe(original.sha256);
    fs.writeFileSync(join(directory, 'package/index.js'), 'export const value = "café";\n');
    fs.writeFileSync(join(directory, '.package-lock.json'), '{"changed":true}');
    expect(hashDependencyTree(directory, fs, crypto).sha256).not.toBe(original.sha256);
    fs.writeFileSync(join(directory, '.package-lock.json'), '{}');
    fs.writeFileSync(join(directory, 'injected.js'), 'unexpected');
    expect(hashDependencyTree(directory, fs, crypto).sha256).not.toBe(original.sha256);
    fs.unlinkSync(join(directory, 'injected.js'));
    fs.unlinkSync(join(directory, 'package/index.js'));
    expect(hashDependencyTree(directory, fs, crypto).sha256).not.toBe(original.sha256);
  } finally {
    if (!basename(directory).startsWith('neslos-dependency-tree-')) throw Error('UNEXPECTED_TEST_DIRECTORY');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('refuses dependency symlinks outside the checked tree without reading their contents', () => {
  let reads = 0;
  const fixtureFs = {
    lstatSync: (path: string) => ({ isDirectory: () => path === '/modules', isSymbolicLink: () => path !== '/modules', isFile: () => false }),
    readdirSync: () => ['escape'], realpathSync: (path: string) => path === '/modules' ? '/modules' : '/private/key',
    readFileSync: () => { reads++; throw Error('MUST_NOT_READ'); }, readlinkSync: () => '/private/key',
  };
  expect(() => hashDependencyTree('/modules', fixtureFs, crypto)).toThrow('DEPENDENCY_TREE_EXTERNAL_LINK');
  expect(reads).toBe(0);
});

it('binds dependency measurements to exact package, lockfile, base image and install settings', () => {
  const pkg = Buffer.from('{"dependencies":{}}'), lock = Buffer.from('{"lockfileVersion":3}');
  const sha = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = { format: 'neslos-tee-dependencies-v1', image: TEE_NODE_IMAGE, platform: 'linux/amd64', nodeVersion: 'v24.22.2', npmVersion: '11.19.1', installArgs: TEE_NPM_ARGS,
    packageSha256: sha(pkg), lockSha256: sha(lock), tree: { sha256: 'a'.repeat(64) } };
  expect(validateDependencyManifest(manifest, pkg, lock)).toBe('a'.repeat(64));
  for (const changed of [
    { ...manifest, image: 'node:latest' }, { ...manifest, platform: 'linux/arm64' },
    { ...manifest, installArgs: ['ci'] }, { ...manifest, tree: { sha256: 'a'.repeat(64) + '\n' } },
  ]) expect(() => validateDependencyManifest(changed, pkg, lock)).toThrow('DEPENDENCY_MANIFEST_MISMATCH');
  expect(() => validateDependencyManifest(manifest, Buffer.from('{}'), lock)).toThrow('DEPENDENCY_MANIFEST_MISMATCH');
  expect(() => validateDependencyManifest(manifest, pkg, Buffer.from('{}'))).toThrow('DEPENDENCY_MANIFEST_MISMATCH');
});
