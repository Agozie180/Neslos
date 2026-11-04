import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTeeIdentity, reportData, verifyTeeEvidence, type TeePolicy } from '../src/core/attestation.js';
import { PrivateRuntime } from '../src/tee/runtime.js';

// The actual published dstack SDK talks to a Unix socket protocol fixture.
// Returned keys/quotes are TEST data. The real DCAP verifier must reject the quote.
describe.skipIf(process.platform !== 'linux')('published dstack SDK protocol and DCAP rejection', () => {
  let server: Server, directory: string, socket: string, keyLength: number;
  let requests: { path: string; body: Record<string, string> }[];
  const pins: TeePolicy = { format: 'neslos-tdx-policy-v1', mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48), rtMr3: '55'.repeat(48) };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'neslos-dstack-')); socket = join(directory, 'fixture.sock'); requests = []; keyLength = 32;
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: req.url!, body });
      const value = req.url === '/GetKey' ? { key: '07'.repeat(keyLength), signature_chain: [] }
        : req.url === '/GetQuote' ? { quote: '00'.repeat(400), event_log: '[]' } : { version: 'fixture-only' };
      const bytes = Buffer.from(JSON.stringify(value)); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': bytes.length }); res.end(bytes);
    });
    await new Promise<void>(resolve => server.listen(socket, resolve));
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  it('derives distinct-purpose keys and sends the exact nonce/key binding to GetQuote', async () => {
    const identity = await createTeeIdentity(socket), nonce = 'aa'.repeat(32);
    const evidence = await identity.attest(nonce);
    expect(requests.filter(r => r.path === '/GetKey').map(r => r.body)).toEqual(expect.arrayContaining([
      { path: 'neslos/executor/v1', purpose: 'authorization', algorithm: 'ed25519' },
      { path: 'neslos/channel/v1', purpose: 'hpke-x25519-ikm', algorithm: 'secp256k1' },
      { path: 'neslos/audit/v1', purpose: 'aes256-gcm', algorithm: 'secp256k1' },
    ]));
    expect(requests.find(r => r.path === '/GetQuote')?.body.report_data).toBe(reportData({ nonce, executorPublicKey: identity.executorPublicKey, transportPublicKey: identity.transportPublicKey }).toString('hex'));
    await expect(verifyTeeEvidence(evidence, pins, nonce)).rejects.toThrow();
  });
  it('does not start the private runtime merely because a dstack socket responds', async () => {
    await expect(PrivateRuntime.create({ network: 'testnet', vault: 'vault.testnet', ownerToken: 'bb'.repeat(32), teePolicy: pins, inferencePolicy: { modelId: 'fixture', gateway: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32) }, model: { osImageHash: 'ee'.repeat(32), composeHash: 'ff'.repeat(32) } }, nearAiKey: 'fixture', journalPath: join(directory, 'audit.json'), socket })).rejects.toThrow();
    expect(requests.some(r => r.path === '/GetQuote')).toBe(true);
  });
  it('rejects malformed derived keys before using them', async () => {
    keyLength = 16;
    await expect(createTeeIdentity(socket)).rejects.toThrow('TEE_KEYS');
  });
});
