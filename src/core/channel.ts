import * as HPKE from 'hpke';
import { z } from 'zod';
import { canonical } from './crypto.js';

/** RFC 9180 HPKE; no custom encryption protocol or raw shared-secret reuse. */
export const channelSuite = new HPKE.CipherSuite(HPKE.KEM_DHKEM_X25519_HKDF_SHA256, HPKE.KDF_HKDF_SHA256, HPKE.AEAD_AES_256_GCM);
export type ChannelKeys = Awaited<ReturnType<typeof channelSuite.GenerateKeyPair>>;
export const envelopeSchema = z.object({ algorithm: z.literal('HPKE-X25519-HKDF-SHA256-AES256GCM'), encapsulatedSecret: z.string().regex(/^[a-f0-9]{64}$/), ciphertext: z.string().min(32).max(500_000).regex(/^[a-f0-9]+$/) }).strict();
export type Envelope = z.infer<typeof envelopeSchema>;
const info = new TextEncoder().encode('neslos:private-channel:v1');
export async function encryptChannel(publicKeyHex: string, data: unknown, associatedData: unknown): Promise<Envelope> {
  if (!/^[a-f0-9]{64}$/.test(publicKeyHex)) throw new Error('Invalid channel public key.');
  const publicKey = await channelSuite.DeserializePublicKey(Buffer.from(publicKeyHex, 'hex'));
  const sealed = await channelSuite.Seal(publicKey, new TextEncoder().encode(canonical(data)), { info, aad: new TextEncoder().encode(canonical(associatedData)) });
  return { algorithm: 'HPKE-X25519-HKDF-SHA256-AES256GCM', encapsulatedSecret: Buffer.from(sealed.encapsulatedSecret).toString('hex'), ciphertext: Buffer.from(sealed.ciphertext).toString('hex') };
}
export async function decryptChannel(keys: ChannelKeys, envelope: Envelope, associatedData: unknown): Promise<unknown> {
  const parsed = envelopeSchema.parse(envelope);
  const bytes = await channelSuite.Open(keys.privateKey, Buffer.from(parsed.encapsulatedSecret, 'hex'), Buffer.from(parsed.ciphertext, 'hex'), { info, aad: new TextEncoder().encode(canonical(associatedData)) });
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
