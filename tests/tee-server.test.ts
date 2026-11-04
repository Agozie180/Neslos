import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrivateApp } from '../src/tee/app.js';
import type { TeeIdentity } from '../src/core/attestation.js';
import type { PrivateRuntime } from '../src/tee/runtime.js';
import { loadRuntimeOptions } from '../src/tee/config.js';

const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); } });
async function start(runtime?: PrivateRuntime) {
  const identity = { attest: vi.fn(async nonce => ({ nonce, fixtureOnly: true })) } as unknown as TeeIdentity;
  const server = createServer(createPrivateApp(identity, runtime)); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + (server.address() as { port: number }).port, identity };
}
describe('TEE HTTP surface and deployment configuration', () => {
  it('bootstrap exposes evidence but refuses private execution and does not claim readiness', async () => {
    const { url } = await start();
    expect(await (await fetch(url + '/health')).json()).toMatchObject({ ready: false, execution: 'attestation-only' });
    const nonce = 'aa'.repeat(32), response = await fetch(url + '/attestation/' + nonce);
    expect(await response.json()).toEqual({ nonce, fixtureOnly: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(url + '/private', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(503);
  });
  it('redacts internal errors and reports an unavailable journal as not ready', async () => {
    const runtime = { ready: false, handle: vi.fn().mockRejectedValue(new Error('private recipient data')) } as unknown as PrivateRuntime;
    const { url } = await start(runtime);
    expect(await (await fetch(url + '/health')).json()).toMatchObject({ ready: false });
    const response = await fetch(url + '/attestation/bad-nonce');
    expect(response.status).toBe(400); expect(await response.text()).toBe('{"error":"Private request rejected."}');
  });
  it('health polling cannot consume the attestation request quota', async () => {
    const { url } = await start();
    for (let i = 0; i < 32; i++) expect((await fetch(url + '/health')).status).toBe(200);
    expect((await fetch(url + '/attestation/' + 'bb'.repeat(32))).status).toBe(200);
  });
  it('requires real policy input and refuses ambiguous FILE/JSON sources', async () => {
    await expect(loadRuntimeOptions({})).rejects.toThrow('NESLOS_NETWORK');
    await expect(loadRuntimeOptions({ NESLOS_NETWORK: 'testnet', NESLOS_VAULT_ACCOUNT: 'vault.testnet', NESLOS_TEE_POLICY_FILE: '/private/pins.json', NESLOS_TEE_POLICY_JSON: '{}' })).rejects.toThrow('Choose FILE or JSON');
  });
});
