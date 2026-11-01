import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuditLog, verifyAudit } from '../src/core/audit.js';
import { commitment, seal, unseal } from '../src/core/crypto.js';

describe('verifiable encrypted audit trail', () => {
  it('encrypts sensitive details, verifies publicly, and opens for the session owner', () => {
    const log = new AuditLog(); const entry = log.append('settled', 'r1', { recipient: 'private-recipient.near', amount: '150000000' });
    expect(JSON.stringify(log.export())).not.toContain('private-recipient.near');
    expect(verifyAudit(log.export()).valid).toBe(true);
    expect(log.open(entry.id)).toEqual({ recipient: 'private-recipient.near', amount: '150000000' });
  });
  it.each(['ciphertext', 'link', 'signature', 'metadata', 'order'])('detects %s tampering', kind => {
    const log = new AuditLog(); log.append('research', 'r1', { a: 1 }); log.append('settled', 'r1', { a: 2 });
    const bundle = log.export();
    if (kind === 'ciphertext') bundle.entries[0]!.sealed.ciphertext += '00';
    if (kind === 'link') bundle.entries[1]!.previousHash = 'f'.repeat(64);
    if (kind === 'signature') bundle.entries[0]!.signature = '0'.repeat(128);
    if (kind === 'metadata') bundle.entries[0]!.runId = 'different-run';
    if (kind === 'order') bundle.entries.reverse();
    expect(verifyAudit(bundle).valid).toBe(false);
  });
  it('detects a valid truncated prefix when the latest checkpoint is retained', () => {
    const log = new AuditLog(); log.append('a', 'r1', 1); log.append('b', 'r1', 2);
    const bundle = log.export(); const checkpoint = bundle.checkpoint;
    bundle.entries.pop(); bundle.checkpoint = bundle.entries[0]!.hash;
    expect(verifyAudit(bundle).valid).toBe(true);
    expect(verifyAudit(bundle, log.publicKey, checkpoint).valid).toBe(false);
  });
  it('rejects a replacement signing identity', () => {
    const first = new AuditLog(), attacker = new AuditLog(); attacker.append('a', 'r', 1);
    expect(verifyAudit(attacker.export(), first.publicKey).valid).toBe(false);
  });
  it('accepts an authentic extension of a retained checkpoint', () => {
    const log = new AuditLog(); log.append('a', 'r1', 1); const checkpoint = log.export().checkpoint;
    log.append('b', 'r1', 2);
    expect(verifyAudit(log.export(), log.publicKey, checkpoint).valid).toBe(true);
  });
  it('recovers an encrypted journal with the same attested keys and rejects another identity', () => {
    const keys = { signingSeed: randomBytes(32), encryptionKey: randomBytes(32) };
    const original = new AuditLog('attested', keys); const entry = original.append('prepared', 'private', { recipient: 'private.near' });
    const restored = new AuditLog('attested', keys); restored.restore(original.export());
    expect(restored.open(entry.id)).toEqual({ recipient: 'private.near' });
    expect(restored.export().scope).toBe('attested-executor');
    expect(() => new AuditLog('attested').restore(original.export())).toThrow();
    expect(() => new AuditLog('rehearsal', keys).restore(original.export())).toThrow();
  });
  it('authenticates associated metadata and requires an independent key', () => {
    const key = randomBytes(32), data = seal({ secret: 1 }, key, { run: 1 });
    expect(() => unseal(data, key, { run: 2 })).toThrow();
    expect(() => unseal(data, randomBytes(32), { run: 1 })).toThrow();
  });
  it('salts and domain-separates commitments', () => {
    const salt = randomBytes(32).toString('hex');
    expect(commitment('counterparty', 'alice', salt)).not.toBe(commitment('venue', 'alice', salt));
    expect(commitment('counterparty', 'alice', salt)).not.toBe(commitment('counterparty', 'alice', randomBytes(32).toString('hex')));
    expect(() => commitment('counterparty', 'alice', 'short')).toThrow();
  });
});
