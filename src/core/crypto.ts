import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import type { SealedData } from './types.js';

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value !== null) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  throw new Error('Value cannot be canonically encoded.');
}
export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function commitment(kind: 'counterparty' | 'venue', value: string, salt: string): string {
  if (!/^[a-f0-9]{64}$/.test(salt)) throw new Error('A 32-byte random salt is required.');
  return sha256(canonical({ domain: `neslos:${kind}:v1`, salt, value }));
}
export function keyFromSeed(seed: Uint8Array): { privateKey: KeyObject; publicKey: string } {
  if (seed.length !== 32) throw new Error('An Ed25519 seed must contain 32 bytes.');
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  return { privateKey: key, publicKey };
}
export function signHash(hash: string, key: KeyObject): string { return sign(null, Buffer.from(hash, 'hex'), key).toString('hex'); }
export function verifyHash(hash: string, signature: string, publicKey: string): boolean {
  try {
    if (!/^[a-f0-9]{64}$/.test(hash) || !/^[a-f0-9]{128}$/.test(signature) || !/^[a-f0-9]{64}$/.test(publicKey)) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(hash, 'hex'), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}
export function seal(value: unknown, key: Uint8Array, aad: unknown): SealedData {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonical(aad)));
  const ciphertext = Buffer.concat([cipher.update(canonical(value), 'utf8'), cipher.final()]);
  return { algorithm: 'AES-256-GCM', iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
export function unseal(data: SealedData, key: Uint8Array, aad: unknown): unknown {
  if (data.algorithm !== 'AES-256-GCM') throw new Error('Unsupported encryption format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'hex'));
  decipher.setAAD(Buffer.from(canonical(aad)));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'hex')), decipher.final()]).toString('utf8'));
}
