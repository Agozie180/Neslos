import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createNrasGpuVerifier } from '../src/core/inference-gpu.js';

const realFetch = globalThis.fetch;
const nonce = 'a'.repeat(64);
const keys = generateKeyPairSync('ec', { namedCurve: 'P-384' });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'ES384' };
const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
function token(changes: Record<string, unknown> = {}, wrongKey = false) {
  const now = Math.floor(Date.now() / 1000);
  const message = encode({ alg: 'ES384', kid: jwk.kid }) + '.' + encode({ iss: 'https://nras.attestation.nvidia.com', exp: now + 120, nbf: now - 1, iat: now - 1, eat_nonce: nonce, 'x-nvidia-overall-att-result': true, ...changes });
  return message + '.' + sign('sha384', Buffer.from(message), { key: wrongKey ? generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey : keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
function setup(jwt: string) {
  const snapshots: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const value = String(url);
    if (value === 'https://nras.attestation.nvidia.com/v3/attest/gpu') { expect(init?.body).toBe(JSON.stringify({ nonce })); return Response.json([['JWT', jwt]]); }
    if (value === 'https://nras.attestation.nvidia.com/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    if (value.startsWith('data:')) { snapshots.push(value); return realFetch(value, init); }
    throw new Error('UNEXPECTED_NETWORK');
  });
  vi.stubGlobal('fetch', fetcher);
  return { snapshots, fetcher };
}
afterEach(() => vi.unstubAllGlobals());
it('verifies a signed NVIDIA-format token through the actual SDK', async () => {
  setup(token());
  await expect(createNrasGpuVerifier()(JSON.stringify({ nonce }))).resolves.toBeUndefined();
});
it('waits for the same slightly future token without issuing another NRAS request', async () => {
  const state = setup(token({ nbf: Math.floor(Date.now() / 1000) + 2, iat: Math.floor(Date.now() / 1000) + 2 }));
  await expect(createNrasGpuVerifier()(JSON.stringify({ nonce }))).resolves.toBeUndefined();
  expect(state.snapshots).toHaveLength(2);
  expect(state.snapshots[0]).toBe(state.snapshots[1]);
  expect(state.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/v3/attest/gpu'))).toHaveLength(1);
});
it('rejects excessive future skew after the single bounded wait', async () => {
  const state = setup(token({ nbf: Math.floor(Date.now() / 1000) + 60 }));
  await expect(createNrasGpuVerifier()(JSON.stringify({ nonce }))).rejects.toMatchObject({ failure: { code: 'gpu.jwt_verification_failed', details: { reason: 'not_yet_valid' } } });
  expect(state.snapshots).toHaveLength(2);
});
it.each([
  [{ eat_nonce: 'b'.repeat(64) }, false, 'nonce_mismatch'],
  [{ exp: 1 }, false, 'expired'],
  [{ iss: 'https://evil.invalid' }, false, 'invalid_claims'],
  [{}, true, 'invalid_signature'],
] as const)('does not retry invalid signed evidence %j', async (changes, wrongKey, reason) => {
  const state = setup(token(changes, wrongKey));
  await expect(createNrasGpuVerifier()(JSON.stringify({ nonce }))).rejects.toMatchObject({ failure: { code: 'gpu.jwt_verification_failed', details: { reason } } });
  expect(state.snapshots).toHaveLength(1);
});
it('rejects a signed negative GPU result', async () => {
  setup(token({ 'x-nvidia-overall-att-result': false }));
  await expect(createNrasGpuVerifier()(JSON.stringify({ nonce }))).rejects.toMatchObject({ failure: { code: 'gpu.attestation_rejected' } });
});
