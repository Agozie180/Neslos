import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const modulePath = '../scripts/tee-build.mjs';
const { buildTee, validateTeeBuild, TEE_BUILD_RECEIPT } = await import(modulePath);
const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'neslos-tee-build-')); directories.push(root);
  for (const dir of ['src/tee', 'fixtures']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['package.json', 'package-lock.json', '.node-version']) copyFileSync(resolve(file), join(root, file));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: true, types: [], noEmitOnError: true } }));
  writeFileSync(join(root, 'tsconfig.server.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { rootDir: 'src', outDir: 'dist/server' }, include: ['src'] }));
  writeFileSync(join(root, 'src/tee/index.ts'), 'export const runtime = "tdx";');
  // Use the installed compiler, not a mocked successful process.
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return root;
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('requires a fresh successful build and refuses changed source, fixtures, config or output', () => {
  const root = fixture();
  expect(() => validateTeeBuild(root)).toThrow('TEE_BUILD_RECEIPT_REQUIRED');
  buildTee(root);
  expect(validateTeeBuild(root)).toMatchObject({ status: 'built', nodeVersion: process.version });
  for (const file of ['src/tee/index.ts', 'tsconfig.server.json', 'package-lock.json']) {
    const original = readFileSync(join(root, file));
    writeFileSync(join(root, file), Buffer.concat([original, Buffer.from('\n')]));
    expect(() => validateTeeBuild(root)).toThrow('TEE_BUILD_INPUTS_CHANGED');
    writeFileSync(join(root, file), original);
  }
  writeFileSync(join(root, 'fixtures/extra.json'), '{}');
  expect(() => validateTeeBuild(root)).toThrow('TEE_BUILD_INPUTS_CHANGED');
  unlinkSync(join(root, 'fixtures/extra.json'));
  writeFileSync(join(root, 'dist/server/extra.js'), 'export const stale = true;');
  expect(() => validateTeeBuild(root)).toThrow('TEE_BUILD_OUTPUTS_CHANGED');
  unlinkSync(join(root, 'dist/server/extra.js'));
  writeFileSync(join(root, 'dist/server/tee/index.js'), 'throw Error("changed")');
  expect(() => validateTeeBuild(root)).toThrow('TEE_BUILD_OUTPUTS_CHANGED');
});

it('cleans obsolete emitted files and invalidates the receipt when compilation fails', () => {
  const root = fixture();
  writeFileSync(join(root, 'src/obsolete.ts'), 'export const obsolete = true;');
  buildTee(root);
  expect(existsSync(join(root, 'dist/server/obsolete.js'))).toBe(true);
  unlinkSync(join(root, 'src/obsolete.ts'));
  buildTee(root);
  expect(existsSync(join(root, 'dist/server/obsolete.js'))).toBe(false);
  expect(validateTeeBuild(root).status).toBe('built');
  writeFileSync(join(root, 'src/tee/index.ts'), 'export const invalid: number = "string";');
  expect(() => buildTee(root)).toThrow('TEE_BUILD_COMPILATION_FAILED');
  expect(JSON.parse(readFileSync(join(root, TEE_BUILD_RECEIPT), 'utf8')).status).toBe('failed');
  expect(() => validateTeeBuild(root)).toThrow('TEE_BUILD_NOT_SUCCESSFUL');
});
