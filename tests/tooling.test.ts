import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root: string;
async function put(path: string, value: string) { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, value); }
async function script(name: string, target: string) { await mkdir(join(target, 'scripts'), { recursive: true }); await copyFile(resolve('scripts', name), join(target, 'scripts', name)); }
function run(target: string, name: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  // A WSL run binds its real checkout through NESLOS_SOURCE_ROOT. Each isolated
  // fixture must measure itself, not repeatedly hash the mounted Windows repo.
  return spawnSync(process.execPath, [join(target, 'scripts', name), ...args], { cwd: target, env: { ...process.env, NESLOS_SOURCE_ROOT: target, ...extraEnv }, encoding: 'utf8', timeout: 15000 });
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'neslos-evidence-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('verification evidence lifecycle', () => {
  it('an application failure replaces a previous success with a new failed run', async () => {
    await script('run.mjs', root); await script('evidence.mjs', root);
    await put(join(root, 'artifacts/app-verification.json'), JSON.stringify({ success: true, runId: 'old' }));
    await put(join(root, 'node_modules/vitest/vitest.mjs'), 'process.exit(7);');
    const result = run(root, 'run.mjs', ['verify']);
    expect(result.status).toBe(7);
    const report = JSON.parse(await readFile(join(root, 'artifacts/app-verification.json'), 'utf8'));
    expect(report).toMatchObject({ success: false, status: 'failed', exitCode: 7 }); expect(report.runId).not.toBe('old');
  });
  it.skipIf(process.platform !== 'linux')('a Cargo failure replaces previous success and never attributes an old WASM', async () => {
    await script('contract.mjs', root); await script('evidence.mjs', root);
    await put(join(root, 'artifacts/contract-verification.json'), JSON.stringify({ success: true, wasmSha256: 'old' }));
    await put(join(root, 'bin/cargo'), '#!/bin/sh\necho deliberate-audit-cargo-failure >&2\nexit 9\n');
    const { chmod } = await import('node:fs/promises'); await chmod(join(root, 'bin/cargo'), 0o700);
    const result = run(root, 'contract.mjs', ['unit'], { PATH: join(root, 'bin') + ':' + process.env.PATH });
    expect(result.status).toBe(9);
    const report = JSON.parse(await readFile(join(root, 'artifacts/contract-verification.json'), 'utf8'));
    expect(report).toMatchObject({ success: false, status: 'failed', exitCode: 9 }); expect(report.wasmSha256).toBeUndefined();
    expect(await readFile(join(root, 'artifacts/contract-output.log'), 'utf8')).toContain('deliberate-audit-cargo-failure');
  });
  it('a failed quote command cannot overwrite newer contract or deployment evidence', async () => {
    const cache = join(root, 'cache'), source = join(root, 'source'), snapshot = join(root, 'snapshot.json');
    await script('evidence.mjs', cache);
    for (const path of ['artifacts/contract-verification.json', 'deploy/testnet-proof.json']) {
      await put(join(cache, path), 'old-cache'); await put(join(source, path), 'newer-source');
    }
    expect(run(cache, 'evidence.mjs', ['snapshot', 'quote:dry', snapshot]).status).toBe(0);
    expect(run(cache, 'evidence.mjs', ['publish', 'quote:dry', snapshot, source, '1']).status).toBe(0);
    for (const path of ['artifacts/contract-verification.json', 'deploy/testnet-proof.json']) expect(await readFile(join(source, path), 'utf8')).toBe('newer-source');
    expect(JSON.parse(await readFile(join(source, 'artifacts/wsl-run.json'), 'utf8'))).toMatchObject({ success: false, task: 'quote:dry', copied: [] });
  });
  it('copies only artifacts changed by the matching task, including its failure report', async () => {
    const cache = join(root, 'cache'), source = join(root, 'source'), snapshot = join(root, 'snapshot.json');
    await script('evidence.mjs', cache);
    await put(join(cache, 'artifacts/contract-verification.json'), 'old-success');
    await put(join(cache, 'artifacts/policy_vault.wasm'), 'unchanged-cached-wasm');
    await put(join(source, 'artifacts/policy_vault.wasm'), 'newer-source-wasm');
    expect(run(cache, 'evidence.mjs', ['snapshot', 'test:contract', snapshot]).status).toBe(0);
    await put(join(cache, 'artifacts/contract-verification.json'), JSON.stringify({ success: false, status: 'failed' }));
    expect(run(cache, 'evidence.mjs', ['publish', 'test:contract', snapshot, source, '1']).status).toBe(0);
    expect(JSON.parse(await readFile(join(source, 'artifacts/contract-verification.json'), 'utf8')).success).toBe(false);
    expect(await readFile(join(source, 'artifacts/policy_vault.wasm'), 'utf8')).toBe('newer-source-wasm');
  });
});
