import { describe, expect, it } from 'vitest';
import { authorizationBytes, signAuthorization, type Authorization } from '../src/core/wire.js';
import { keyFromSeed, sha256, verifyHash } from '../src/core/crypto.js';
export const vector: Authorization = {
  domain: 'neslos:authorize:v1', network: 'testnet', vault: 'vault.testnet', policy_version: '1', nonce: '0',
  amount: '150000000', quoted_output: '150000000', minimum_output: '149625000', slippage_bps: 25,
  quoted_at_ms: '1793577599000', expires_at_ms: '1793577659000', venue_commitment: 'a'.repeat(64),
  strategy_venue_commitment: null, counterparty_commitment: 'b'.repeat(64), deposit_account: 'deposit.testnet',
  output_asset: 'nep141:usdt.tether-token.near', quote_hash: 'c'.repeat(64), confidential: true, action: 0, audit_hash: 'd'.repeat(64),
};
describe('cross-language authorization', () => {
  it('matches the exact Rust Borsh signing vector', () => {
    expect(sha256(authorizationBytes(vector))).toBe('5bbf40ba5577220ae67679f9977f3aff7b205ea2961a13724e040b80237731db');
  });
  it('binds every important destination and budget field to the signature', () => {
    const key = keyFromSeed(new Uint8Array(32).fill(7));
    const signed = signAuthorization(vector, key.privateKey);
    expect(verifyHash(signed.hash, signed.signature, key.publicKey)).toBe(true);
    for (const change of [{ deposit_account: 'attacker.testnet' }, { network: 'mainnet' as const }, { amount: '150000001' }, { nonce: '1' }, { confidential: false }, { minimum_output: '1' }]) {
      expect(verifyHash(sha256(authorizationBytes({ ...vector, ...change })), signed.signature, key.publicKey)).toBe(false);
    }
  });
  it('rejects u64 overflow and noncanonical integers before signing', () => {
    expect(() => authorizationBytes({ ...vector, nonce: '18446744073709551616' })).toThrow();
    expect(() => authorizationBytes({ ...vector, amount: '01' })).toThrow();
  });
});
