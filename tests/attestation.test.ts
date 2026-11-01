import { describe, expect, it } from 'vitest';
import type { TDReport10 } from '@phala/dcap-qvl';
import { assertTdxBindings, reportData, teePolicySchema, verifyTeeEvidence, type TeeEvidence, type TeePolicy } from '../src/core/attestation.js';
import { channelSuite, decryptChannel, encryptChannel } from '../src/core/channel.js';
const pinned: TeePolicy = { format: 'neslos-tdx-policy-v1', mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48), rtMr3: '55'.repeat(48) };
const evidence: TeeEvidence = { format: 'neslos-tdx-evidence-v1', nonce: 'aa'.repeat(32), executorPublicKey: 'bb'.repeat(32), transportPublicKey: 'cc'.repeat(32), quote: '00'.repeat(400), eventLog: '[]' };
function report(): TDReport10 {
  // A structural fixture for binding checks, not a cryptographically valid quote.
  // The package declares TDReport10 but does not export its constructor at runtime.
  return {
    teeTcbSvn: new Uint8Array(16), mrSeam: new Uint8Array(48), mrSignerSeam: new Uint8Array(48),
    seamAttributes: new Uint8Array(8), tdAttributes: new Uint8Array(8), xfam: new Uint8Array(8),
    mrTd: Buffer.from(pinned.mrTd, 'hex'), mrConfigId: new Uint8Array(48),
    mrOwner: new Uint8Array(48), mrOwnerConfig: new Uint8Array(48),
    rtMr0: Buffer.from(pinned.rtMr0, 'hex'), rtMr1: Buffer.from(pinned.rtMr1, 'hex'),
    rtMr2: Buffer.from(pinned.rtMr2, 'hex'), rtMr3: Buffer.from(pinned.rtMr3, 'hex'),
    reportData: reportData({ nonce: evidence.nonce, executorPublicKey: evidence.executorPublicKey, transportPublicKey: evidence.transportPublicKey }),
  };
}
describe('TEE trust boundary', () => {
  it('validates binding logic against independently fixed measurement fixtures', () => {
    expect(() => assertTdxBindings(report(), evidence, pinned, evidence.nonce)).not.toThrow();
  });
  it.each(['nonce', 'executorPublicKey', 'transportPublicKey'] as const)('rejects substituted %s', field => {
    expect(() => assertTdxBindings(report(), { ...evidence, [field]: 'ff'.repeat(32) }, pinned, evidence.nonce)).toThrow();
  });
  it.each(['mrTd', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3'] as const)('rejects unapproved %s', field => {
    const modified = report(); modified[field] = new Uint8Array(48);
    expect(() => assertTdxBindings(modified, evidence, pinned, evidence.nonce)).toThrow('ATTESTATION_MEASUREMENT');
  });
  it('rejects debug enclaves', () => {
    const modified = report(); modified.tdAttributes[0] = 1;
    expect(() => assertTdxBindings(modified, evidence, pinned, evidence.nonce)).toThrow('ATTESTATION_DEBUG');
  });
  it('does not accept malformed quotes or a self-reported verified flag', async () => {
    await expect(verifyTeeEvidence(evidence, pinned, evidence.nonce)).rejects.toThrow();
    await expect(verifyTeeEvidence({ verified: true }, pinned, evidence.nonce)).rejects.toThrow();
    expect(() => teePolicySchema.parse({ ...pinned, mrTd: 'trust-me' })).toThrow();
  });
});
describe('RFC 9180 private channel', () => {
  it('encrypts to the recipient, authenticates context, and rejects ciphertext alteration', async () => {
    const recipient = await channelSuite.GenerateKeyPair();
    const pub = Buffer.from(await channelSuite.SerializePublicKey(recipient.publicKey)).toString('hex');
    const aad = { direction: 'request', nonce: 'fresh' };
    const envelope = await encryptChannel(pub, { recipient: 'alice.near', amount: '123456789' }, aad);
    expect(envelope.ciphertext).not.toContain('alice');
    expect(await decryptChannel(recipient, envelope, aad)).toEqual({ recipient: 'alice.near', amount: '123456789' });
    await expect(decryptChannel(recipient, envelope, { direction: 'response', nonce: 'fresh' })).rejects.toThrow();
    await expect(decryptChannel(recipient, { ...envelope, ciphertext: envelope.ciphertext + '00' }, aad)).rejects.toThrow();
    const attacker = await channelSuite.GenerateKeyPair();
    await expect(decryptChannel(attacker, envelope, aad)).rejects.toThrow();
  });
});
