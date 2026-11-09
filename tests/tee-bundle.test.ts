import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { afterEach, expect, it } from 'vitest';

const directories: string[] = [];
const image = 'ghcr.io/example/neslos-tee@sha256:' + 'a'.repeat(64);
async function bundle(vault: string) {
  const directory = await mkdtemp(join(tmpdir(), 'neslos-tee-target-'));
  directories.push(directory);
  const out = join(directory, 'bundle');
  const result = spawnSync(process.execPath, [resolve('scripts/tee-bundle.mjs'), '--image', image, '--out', out, '--testnet-vault', vault], { encoding: 'utf8', windowsHide: true });
  return { out, result };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('binds the testnet vault into the measured Compose without accepting an environment override', async () => {
  const { out, result } = await bundle('vault.neslos.testnet');
  expect(result.status, result.stderr).toBe(0);
  const compose = await readFile(join(out, 'compose.yaml'), 'utf8');
  const configuration = parse(compose);
  expect(configuration.services.neslos.image).toBe(image);
  expect(configuration.services.neslos.environment).toContain('NESLOS_NETWORK=testnet');
  expect(configuration.services.neslos.environment).toContain('NESLOS_VAULT_ACCOUNT=vault.neslos.testnet');
  expect(compose).not.toContain('${NESLOS_NETWORK');
  expect(compose).not.toContain('${NESLOS_VAULT_ACCOUNT');
  expect(JSON.parse(await readFile(join(out, 'deployment.json'), 'utf8'))).toMatchObject({
    target: { network: 'testnet', vault: 'vault.neslos.testnet' },
    composeSha256: createHash('sha256').update(compose).digest('hex'),
    status: 'prepared-not-deployed',
  });
});

it.each(['vault.neslos.near', 'vault..neslos.testnet', 'vault.neslos.testnet\n', 'x'.repeat(57) + '.testnet'])('rejects an invalid testnet target before writing a bundle: %j', async vault => {
  const { out, result } = await bundle(vault);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('TESTNET_VAULT_REQUIRED');
  await expect(access(out)).rejects.toThrow();
});
