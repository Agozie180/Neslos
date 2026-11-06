import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { basename, join, relative, isAbsolute } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inferenceBootFixture, modelDeploymentFixture } from './fixtures/inference.js';

const fixture = vi.hoisted(() => ({ directory: '', reservation: '', events: [] as string[], chat: vi.fn(), receipt: vi.fn() }));

// Execute the real script with real exclusive files and fsync, but prevent every
// filesystem operation it imports from escaping this test's temporary directory.
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const path = await import('node:path');
  const checked = (value: unknown): string => {
    if (typeof value !== 'string' || !fixture.directory) throw new Error('TEST_FS_ESCAPE');
    const rel = path.relative(fixture.directory, path.resolve(value));
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('TEST_FS_ESCAPE');
    return value;
  };
  return {
    ...fs,
    mkdir: (name: string, options: Parameters<typeof fs.mkdir>[1]) => fs.mkdir(checked(name), options),
    readFile: (name: string, options: Parameters<typeof fs.readFile>[1]) => fs.readFile(checked(name), options),
    writeFile: async (name: string, data: string, options: Parameters<typeof fs.writeFile>[2]) => {
      await fs.writeFile(checked(name), data, options);
      fixture.events.push('output-saved');
    },
    open: async (name: string, flags: string, mode?: number) => {
      const handle = await fs.open(checked(name), flags, mode);
      return new Proxy(handle, { get(target, property) {
        if (property === 'sync') return async () => {
          await target.sync();
          fixture.events.push(name === fixture.reservation ? 'reservation-synced' : 'directory-synced');
        };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    },
  };
});

vi.mock('node:url', async importOriginal => {
  const actual = await importOriginal<typeof import('node:url')>();
  return { ...actual, fileURLToPath(value: string | URL) {
    const result = actual.fileURLToPath(value);
    if (result.endsWith('provenance-live-inference-reservation.json')) {
      // The only script-relative path redirected is its fixed reservation.
      expect(result.replaceAll('\\', '/')).toMatch(/\/\.private\/provenance-live-inference-reservation\.json$/);
      return fixture.reservation;
    }
    return result;
  } };
});

vi.mock('../src/core/inference.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/inference.js')>();
  return { ...actual, createVerifiedInferenceClient: vi.fn((_policy: unknown, key: string) => {
    expect(key).toBe('fixture-api-key');
    return { verify: async () => ({ models: [{}] }), chat: { completions: { create: fixture.chat } }, verifyResponse: fixture.receipt };
  }) };
});

const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const completion = { id: 'fixture-completion', choices: [{ message: { content: 'Neslos verified inference.' } }], usage: { total_tokens: 8 } };
let logged: ReturnType<typeof vi.spyOn>, failed: ReturnType<typeof vi.spyOn>;
let originalExitCode: typeof process.exitCode;

beforeEach(async () => {
  fixture.directory = await fs.mkdtemp(join(tmpdir(), 'neslos-provenance-probe-test-'));
  fixture.reservation = join(fixture.directory, 'provenance-live-inference-reservation.json');
  fixture.events = [];
  fixture.chat.mockReset(); fixture.receipt.mockReset();
  fixture.chat.mockImplementation(async () => {
    const reservation = JSON.parse(await fs.readFile(fixture.reservation, 'utf8')) as { calls: number; reservedNanoUsd: string };
    expect(reservation.calls).toBe(1);
    expect(BigInt(reservation.reservedNanoUsd)).toBeLessThanOrEqual(10_000_000n);
    expect(fixture.events).toContain('reservation-synced');
    if (process.platform !== 'win32') expect(fixture.events).toContain('directory-synced');
    fixture.events.push('chat');
    return completion;
  });
  fixture.receipt.mockResolvedValue({ signatureKind: 'provider_tee' });
  logged = vi.spyOn(console, 'log').mockImplementation(() => {});
  failed = vi.spyOn(console, 'error').mockImplementation(() => {});
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.stubEnv('NEARAI_API_KEY', 'fixture-api-key');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('https://cloud-api.near.ai/v1/model/list');
    return { json: async () => ({ models: [{ modelId: 'fixture-model', inputCostPerToken: { amount: 1, scale: 9, currency: 'USD' }, outputCostPerToken: { amount: 1, scale: 9, currency: 'USD' }, metadata: { verifiable: true, attestationSupported: true, providerType: 'vllm' } }] }) };
  }));
  await fs.writeFile(join(fixture.directory, 'policy.json'), JSON.stringify({
    modelId: 'fixture-model', gateway: { osImageHash: 'a'.repeat(64), composeHash: 'b'.repeat(64), boot: inferenceBootFixture },
    model: { osImageHash: 'c'.repeat(64), composeHash: 'd'.repeat(64), boot: inferenceBootFixture }, modelDeployment: modelDeploymentFixture,
    budget: { totalLimitNanoUsd: '250000000', dailyLimitNanoUsd: '250000000', maxCalls: 100, maxInputBytes: 24000, maxOutputTokens: 128, inputNanoUsdPerToken: '1', outputNanoUsdPerToken: '1' },
  }));
});

afterEach(async () => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  const parent = relative(tmpdir(), fixture.directory);
  assert.ok(!isAbsolute(parent) && !parent.startsWith('..') && basename(fixture.directory).startsWith('neslos-provenance-probe-test-'));
  await fs.rm(fixture.directory, { recursive: true, force: true });
});

async function invoke(output: string) {
  const argv = process.argv;
  process.argv = [process.execPath, 'provenance-live-inference.ts', '--policy', join(fixture.directory, 'policy.json'), '--out', join(fixture.directory, output)];
  try { vi.resetModules(); await import('../scripts/provenance-live-inference.js'); }
  finally { process.argv = argv; }
}

it('durably reserves before Chat/output and refuses a second invocation with a new output filename', async () => {
  await invoke('first.json');
  await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
  expect(failed).not.toHaveBeenCalled();
  expect(fixture.events.indexOf('reservation-synced')).toBeLessThan(fixture.events.indexOf('chat'));
  expect(fixture.events.indexOf('chat')).toBeLessThan(fixture.events.indexOf('output-saved'));
  const first = JSON.parse(await fs.readFile(join(fixture.directory, 'first.json'), 'utf8'));
  expect(first).toMatchObject({ callerExecution: 'local-unattested', inferenceCalls: 1, responseVerified: true });
  const guard = await fs.readFile(fixture.reservation, 'utf8');
  await invoke('second.json');
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  expect(fixture.chat).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(fixture.reservation, 'utf8')).toBe(guard);
  expect(await fs.readFile(join(fixture.directory, 'second.json'), 'utf8')).toBe('');
});

it('retains the charged guard after an unknown Chat outcome and blocks a retry', async () => {
  fixture.chat.mockRejectedValue(new Error('PROVIDER_TIMEOUT'));
  await invoke('failed.json');
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  const guard = await fs.readFile(fixture.reservation, 'utf8');
  expect(JSON.parse(guard)).toMatchObject({ calls: 1, modelId: 'fixture-model' });
  await invoke('retry.json');
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  expect(fixture.chat).toHaveBeenCalledTimes(1);
  expect(fixture.receipt).not.toHaveBeenCalled();
  expect(await fs.readFile(fixture.reservation, 'utf8')).toBe(guard);
});

it('allows only one concurrent invocation to reach Chat without clobbering its reservation', async () => {
  let release!: () => void;
  const pending = new Promise<typeof completion>(resolve => { release = () => resolve(completion); });
  fixture.chat.mockImplementation(() => pending);
  try {
    await invoke('concurrent-first.json');
    await vi.waitFor(() => expect(fixture.chat).toHaveBeenCalledTimes(1));
    const guard = await fs.readFile(fixture.reservation, 'utf8');
    await invoke('concurrent-second.json');
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(fixture.chat).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(fixture.reservation, 'utf8')).toBe(guard);
  } finally {
    release();
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
  }
});
