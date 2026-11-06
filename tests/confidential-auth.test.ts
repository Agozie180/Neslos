import { mkdtemp, readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair, baseDecode } from 'near-api-js';
import { describe, expect, it, vi } from 'vitest';
import { canonical, sha256 } from '../src/core/crypto.js';
import { assertConfidentialAuthPayload, authenticateConfidentialOwner, classifyConfidentialAuthFailure, ConfidentialAuthHttpError, confidentialImplicitId, fetchConfidentialNonceSalt, makeConfidentialAuthPayload, readConfidentialOwnerBalances } from '../src/owner/confidential-auth.js';

const sessionFile = async () => join(await mkdtemp(join(tmpdir(), 'neslos-confidential-auth-')), 'session.json');
const authResponse = (status = 200) => new Response(JSON.stringify({ accessToken: 'fixture-sensitive-access-token', refreshToken: 'fixture-sensitive-refresh-token', expiresIn: 600, refreshExpiresIn: 3600 }), { status });
const SALT = '252812b3';
const networkResponse = (chain = 'mainnet') => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'confidential-auth-network', result: { chain_id: chain } }));
const saltResponse = (salt = SALT) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'confidential-auth-salt', result: { block_height: 223308866, block_hash: 'GtQuxjyU3RatJAojr3d6hWg72GpTUtQZA1TwXKpxkXvV', result: Array.from(Buffer.from(JSON.stringify(salt))) } }));
const readyFetch = () => vi.fn<typeof fetch>().mockResolvedValueOnce(networkResponse()).mockResolvedValueOnce(saltResponse());
describe('no-spend confidential recipient authentication', () => {
  it('verifies the published SDK raw_ed25519 vector over payload bytes, independently of our signer', () => {
    // Official vector: https://github.com/defuse-protocol/sdk-monorepo/blob/main/packages/intents-sdk/src/intents/intent-hash.test.ts
    const payload = '{"signer_id":"74affa71ab030d400fdfa1bed033dfa6fd3ae34f92d17c046ebe368e80d53751","verifying_contract":"intents.near","deadline":"2035-11-03T14:49:44.589Z","nonce":"1TwpgYHWXK29O6zby1R6QPJOY/Nb/S9Bb+dJ8m+Dd2Q=","intents":[]}';
    const publicKey = 'ed25519:8rVvtHWFr8hasdQGGD5WiQBTyr4iH2ruEPPVfj491RPN';
    const signature = baseDecode('4N9DSi9Vh6w9Jq1ybkiS2g9fb1P1jM2Uh35huT3qc6PM8yeCQYE1gPTCN9iDQA6vh9NFrqCP1xWpHJET9U7AnJ7x');
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), baseDecode(publicKey.slice(8))]), format: 'der', type: 'spki' });
    expect(confidentialImplicitId(publicKey)).toBe(JSON.parse(payload).signer_id);
    expect(verify(null, Buffer.from(payload, 'utf8'), key, signature)).toBe(true);
    expect(verify(null, Buffer.from(sha256(payload), 'hex'), key, signature)).toBe(false);
  });
  it('encodes the official timestamped versioned nonce and derives identity from the existing public key', () => {
    const key = KeyPair.fromRandom('ed25519'), pub = key.getPublicKey().toString(), now = 1793966400000;
    const payload = makeConfidentialAuthPayload(pub, SALT, now, new Uint8Array([1, 2, 3, 4, 5, 6, 7])), parsed = JSON.parse(payload), nonce = Buffer.from(parsed.nonce, 'base64');
    expect(parsed.signer_id).toBe(Buffer.from(baseDecode(pub.slice(8))).toString('hex'));
    expect(parsed).toMatchObject({ verifying_contract: 'intents.near', intents: [], deadline: new Date(now + 180000).toISOString() });
    expect(nonce.subarray(0, 9).toString('hex')).toBe('5628f6c600252812b3');
    expect(nonce.readBigUInt64LE(9)).toBe(BigInt(now + 180000) * 1000000n); expect(nonce.readBigUInt64LE(17)).toBe(BigInt(now) * 1000000n);
    expect(nonce.subarray(25)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7]));
    expect(() => assertConfidentialAuthPayload(payload, pub, parsed.signer_id, SALT, now)).not.toThrow();
  });
  it('refuses spending intents, key changes, other audiences, extra fields, expired and malformed nonces', () => {
    const key = KeyPair.fromRandom('ed25519'), pub = key.getPublicKey().toString(), now = Date.now(), id = confidentialImplicitId(pub), payload = makeConfidentialAuthPayload(pub, SALT, now), parsed = JSON.parse(payload);
    for (const change of [{ intents: [{ intent: 'transfer', receiver_id: 'attacker.near', tokens: { 'nep141:wrap.near': '1' } }] }, { verifying_contract: 'intents.far' }, { callbackUrl: 'https://attacker.test' }]) expect(() => assertConfidentialAuthPayload(canonical({ ...parsed, ...change }), pub, id, SALT, now)).toThrow('CONFIDENTIAL_AUTH_PAYLOAD');
    expect(() => assertConfidentialAuthPayload(payload, pub, 'a'.repeat(64), SALT, now)).toThrow('CONFIDENTIAL_AUTH_IDENTITY');
    expect(() => assertConfidentialAuthPayload(payload, pub, id, SALT, now + 180000)).toThrow('CONFIDENTIAL_AUTH_TIME');
    expect(() => assertConfidentialAuthPayload(payload, pub, id, SALT, now - 1)).toThrow('CONFIDENTIAL_AUTH_TIME');
    expect(() => assertConfidentialAuthPayload(payload, pub, id, 'e110f317', now)).toThrow('CONFIDENTIAL_AUTH_NONCE');
    const bad = Buffer.from(parsed.nonce, 'base64'); bad[5] = bad[5]! ^ 1;
    expect(() => assertConfidentialAuthPayload(canonical({ ...parsed, nonce: bad.toString('base64') }), pub, id, SALT, now)).toThrow('CONFIDENTIAL_AUTH_NONCE');
  });
  it('checks the expected recipient before signing or making any network request', async () => {
    const key = KeyPair.fromRandom('ed25519'), sign = vi.spyOn(key, 'sign'), fetchImpl = vi.fn<typeof fetch>();
    await expect(authenticateConfidentialOwner(key, 'a'.repeat(64), await sessionFile(), fetchImpl)).rejects.toThrow('CONFIDENTIAL_AUTH_IDENTITY');
    expect(sign).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([200, 201])('accepts HTTP %i after reading current mainnet salt and keeps tokens out of return values', async status => {
    const key = KeyPair.fromRandom('ed25519'), id = confidentialImplicitId(key.getPublicKey().toString()), file = await sessionFile(), fetchImpl = readyFetch().mockResolvedValueOnce(authResponse(status));
    const summary = await authenticateConfidentialOwner(key, id, file, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://rpc.fastnear.com');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)).method).toBe('status');
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).params).toEqual({ request_type: 'call_function', finality: 'final', account_id: 'intents.near', method_name: 'current_salt', args_base64: 'e30=' });
    const [url, options] = fetchImpl.mock.calls[2]!; expect(url).toBe('https://1click.chaindefuser.com/v0/auth/authenticate'); expect(options?.redirect).toBe('error');
    const signed = JSON.parse(String(options?.body)).signedData;
    expect(signed.standard).toBe('raw_ed25519'); expect(JSON.parse(signed.payload).intents).toEqual([]);
    expect(Buffer.from(JSON.parse(signed.payload).nonce, 'base64').subarray(5, 9).toString('hex')).toBe(SALT);
    expect(key.verify(Buffer.from(signed.payload), baseDecode(signed.signature.slice(8)))).toBe(true);
    expect(key.verify(Buffer.from(sha256(signed.payload), 'hex'), baseDecode(signed.signature.slice(8)))).toBe(false);
    expect(JSON.stringify(summary)).not.toContain('fixture-sensitive'); expect(summary).toMatchObject({ authenticated: true, noSpendIntent: true, recipient: id });
    const saved = JSON.parse(await readFile(file, 'utf8')); expect(saved.accessToken).toBe('fixture-sensitive-access-token'); expect(saved.refreshToken).toBe('fixture-sensitive-refresh-token');
    await expect(authenticateConfidentialOwner(key, id, file, fetchImpl)).rejects.toThrow('CONFIDENTIAL_AUTH_SESSION_EXISTS'); expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('reads the private balance with the saved User-Session and refuses another recipient', async () => {
    const key = KeyPair.fromRandom('ed25519'), id = confidentialImplicitId(key.getPublicKey().toString()), file = await sessionFile();
    await authenticateConfidentialOwner(key, id, file, readyFetch().mockResolvedValueOnce(authResponse()));
    const read = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ balances: [{ tokenId: 'nep141:wrap.near', available: '0', source: 'private' }] })));
    expect(await readConfidentialOwnerBalances(file, id, read)).toEqual({ recipient: id, balances: [{ tokenId: 'nep141:wrap.near', available: '0', source: 'private' }] });
    expect(read.mock.calls[0]![1]?.headers).toEqual({ authorization: 'Bearer fixture-sensitive-access-token', accept: 'application/json' });
    await expect(readConfidentialOwnerBalances(file, 'f'.repeat(64), read)).rejects.toThrow('CONFIDENTIAL_AUTH_IDENTITY'); expect(read).toHaveBeenCalledTimes(1);
  });
  it('does not echo upstream token-bearing error text or retry authentication', async () => {
    const key = KeyPair.fromRandom('ed25519'), id = confidentialImplicitId(key.getPublicKey().toString()), fetchImpl = readyFetch().mockResolvedValueOnce(new Response('fixture-sensitive-token', { status: 401 }));
    await expect(authenticateConfidentialOwner(key, id, await sessionFile(), fetchImpl)).rejects.toThrow(/^CONFIDENTIAL_AUTH_HTTP_401$/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('classifies provider errors into fixed labels without copying arbitrary provider content', () => {
    expect(classifyConfidentialAuthFailure({ message: 'timestamp validation failed: secret' })).toBe('TIMESTAMP_VALIDATION_FAILED');
    expect(classifyConfidentialAuthFailure({ message: 'invalid nonce: secret' })).toBe('INVALID_NONCE');
    expect(classifyConfidentialAuthFailure({ message: 'signature verification failed: secret' })).toBe('SIGNATURE_VERIFICATION_FAILED');
    expect(classifyConfidentialAuthFailure({ message: ['signedData must be an object'] })).toBe('INVALID_SIGNED_DATA');
    expect(classifyConfidentialAuthFailure({ message: 'JWT token is required: secret' })).toBe('PARTNER_AUTH_REQUIRED');
    expect(classifyConfidentialAuthFailure({ message: 'Invalid API key: secret' })).toBe('PARTNER_AUTH_INVALID');
    expect(classifyConfidentialAuthFailure({ message: 'User authentication is required for confidential intent quotes.' })).toBe('USER_AUTH_REQUIRED');
    expect(classifyConfidentialAuthFailure({ message: 'arbitrary secret', code: 'ATTACKER_CONTROLLED_VALUE', accessToken: 'sensitive' })).toBe('UNCLASSIFIED');
  });
  it('exposes only redacted optional diagnostics even when upstream echoes signed data and tokens', async () => {
    const key = KeyPair.fromRandom('ed25519'), id = confidentialImplicitId(key.getPublicKey().toString()), file = await sessionFile();
    const fetchImpl = readyFetch().mockImplementationOnce(async (_url, options) => new Response(JSON.stringify({
      message: 'signature verification failed: fixture-sensitive-token', error: 'Unauthorized', statusCode: 401,
      accessToken: 'fixture-sensitive-access-token', refreshToken: 'fixture-sensitive-refresh-token', signedData: JSON.parse(String(options?.body)).signedData,
    }), { status: 401 }));
    let error: unknown;
    try { await authenticateConfidentialOwner(key, id, file, fetchImpl, { includeErrorCode: true }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ConfidentialAuthHttpError);
    expect((error as ConfidentialAuthHttpError).diagnostic).toEqual({ httpStatus: 401, providerCode: 'SIGNATURE_VERIFICATION_FAILED' });
    const serialized = String(error) + JSON.stringify(error); expect(serialized).not.toContain('fixture-sensitive'); expect(serialized).not.toContain(id); expect(serialized).not.toContain('signedData');
    expect(fetchImpl).toHaveBeenCalledTimes(3); await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('redacts non-JSON and excessive diagnostic bodies without changing the original HTTP failure', async () => {
    for (const body of ['fixture-sensitive-token', JSON.stringify({ message: 'x'.repeat(131073) })]) {
      const key = KeyPair.fromRandom('ed25519'), id = confidentialImplicitId(key.getPublicKey().toString());
      await expect(authenticateConfidentialOwner(key, id, await sessionFile(), readyFetch().mockResolvedValueOnce(new Response(body, { status: 401 })), { includeErrorCode: true })).rejects.toMatchObject({ message: 'CONFIDENTIAL_AUTH_HTTP_401', diagnostic: { httpStatus: 401, providerCode: 'UNCLASSIFIED' } });
    }
  });
  it('fails before signing on wrong network, invalid salt, or a failed salt read', async () => {
    const key = KeyPair.fromRandom('ed25519'), id = confidentialImplicitId(key.getPublicKey().toString()), sign = vi.spyOn(key, 'sign');
    const wrongNetwork = vi.fn<typeof fetch>().mockResolvedValueOnce(networkResponse('testnet'));
    await expect(authenticateConfidentialOwner(key, id, await sessionFile(), wrongNetwork)).rejects.toThrow('CONFIDENTIAL_AUTH_NETWORK_INVALID');
    for (const salt of ['abcd', '252812b300', 'ZZZZZZZZ', '252812B3']) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(networkResponse()).mockResolvedValueOnce(saltResponse(salt));
      await expect(authenticateConfidentialOwner(key, id, await sessionFile(), fetchImpl)).rejects.toThrow('CONFIDENTIAL_AUTH_SALT_INVALID');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
    await expect(fetchConfidentialNonceSalt(vi.fn<typeof fetch>().mockResolvedValueOnce(networkResponse()).mockRejectedValueOnce(new Error('fixture-sensitive')))).rejects.toThrow('CONFIDENTIAL_AUTH_SALT_UNAVAILABLE');
    expect(sign).not.toHaveBeenCalled(); expect(wrongNetwork).toHaveBeenCalledTimes(1);
  });
});
