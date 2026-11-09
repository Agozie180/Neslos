import { randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';
import { DstackClient } from '@phala/dstack-sdk';
import { getCollateralAndVerify, type TDReport10 } from '@phala/dcap-qvl';
import { z } from 'zod';
import { canonical, keyFromSeed, sha256 } from './crypto.js';
import { channelSuite, type ChannelKeys } from './channel.js';
import { hashHex } from './wire.js';

const measurement = z.string().regex(/^[a-f0-9]{96}$/);
export const teePolicySchema = z.object({
  format: z.literal('neslos-tdx-policy-v1'), mrTd: measurement, rtMr0: measurement, rtMr1: measurement, rtMr2: measurement, rtMr3: measurement,
}).strict();
export type TeePolicy = z.infer<typeof teePolicySchema>;
export const attestationSchema = z.object({ format: z.literal('neslos-tdx-evidence-v1'), nonce: hashHex, executorPublicKey: hashHex, transportPublicKey: hashHex, quote: z.string().regex(/^[a-f0-9]+$/).min(800).max(100_000), eventLog: z.string().max(500_000) }).strict();
export type TeeEvidence = z.infer<typeof attestationSchema>;
export function reportData(binding: Pick<TeeEvidence, 'nonce' | 'executorPublicKey' | 'transportPublicKey'>): Buffer {
  hashHex.parse(binding.nonce); hashHex.parse(binding.executorPublicKey); hashHex.parse(binding.transportPublicKey);
  return Buffer.concat([Buffer.from(sha256(canonical({ domain: 'neslos:tdx-keys:v1', ...binding })), 'hex'), Buffer.alloc(32)]);
}

/** Input MUST be the report returned by the cryptographic Intel/DCAP verifier. */
export function assertTdxBindings(td: TDReport10, evidence: TeeEvidence, policy: TeePolicy, expectedNonce: string): void {
  teePolicySchema.parse(policy);
  if (evidence.nonce !== hashHex.parse(expectedNonce)) throw new Error('ATTESTATION_NONCE: evidence belongs to another challenge.');
  if ((td.tdAttributes[0]! & 1) !== 0) throw new Error('ATTESTATION_DEBUG: debug enclaves are forbidden.');
  const expected = reportData({ nonce: evidence.nonce, executorPublicKey: evidence.executorPublicKey, transportPublicKey: evidence.transportPublicKey });
  if (td.reportData.length !== expected.length || !timingSafeEqual(expected, td.reportData)) throw new Error('ATTESTATION_BINDING: signing or encryption key does not match the quote.');
  for (const name of ['mrTd', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3'] as const) {
    if (Buffer.from(td[name]).toString('hex') !== policy[name]) throw new Error(`ATTESTATION_MEASUREMENT: ${name} is not independently approved.`);
  }
}
export async function verifyTeeEvidence(input: unknown, pinned: TeePolicy, expectedNonce: string) {
  const evidence = attestationSchema.parse(input);
  const verified = await getCollateralAndVerify(Buffer.from(evidence.quote, 'hex'));
  if (verified.status !== 'UpToDate') throw new Error(`ATTESTATION_TCB: ${verified.status} is not accepted.`);
  const td = verified.report.asTd10();
  if (!td) throw new Error('ATTESTATION_PLATFORM: Intel TDX is required.');
  assertTdxBindings(td, evidence, pinned, expectedNonce);
  return { verified: true as const, tcb: verified.status, executorPublicKey: evidence.executorPublicKey, transportPublicKey: evidence.transportPublicKey, measurements: teePolicySchema.parse(pinned), verifiedAt: new Date().toISOString() };
}

export interface TeeIdentity { signingKey: KeyObject; executorPublicKey: string; channelKeys: ChannelKeys; transportPublicKey: string; auditKey: Uint8Array; signingSeed: Uint8Array; attest: (nonce: string) => Promise<TeeEvidence>; platformInfo?: () => Promise<{ format: 'neslos-platform-info-v1'; appId: string; instanceId: string; vmConfig: string | null }> }
export async function createTeeIdentity(socket = '/var/run/dstack.sock'): Promise<TeeIdentity> {
  if (process.platform !== 'linux' || !socket.startsWith('/') || process.env.DSTACK_SIMULATOR_ENDPOINT || process.env.TAPPD_SIMULATOR_ENDPOINT) throw new Error('TEE_REQUIRED: use a real Linux dstack socket, without simulator endpoints.');
  const client = new DstackClient(socket);
  const results = await Promise.allSettled([
    client.getKey('neslos/executor/v1', 'authorization', 'ed25519'),
    client.getKey('neslos/channel/v1', 'hpke-x25519-ikm'),
    client.getKey('neslos/audit/v1', 'aes256-gcm'),
  ]);
  for (const r of results) if (r.status === 'rejected') throw new Error('TEE_KEYS: enclave key derivation failed.', { cause: r.reason });
  const [signing, transport, audit] = results.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<DstackClient['getKey']>>>).value);
  if (signing!.key.length !== 32 || audit!.key.length !== 32 || transport!.key.length !== 32) throw new Error('TEE_KEYS: invalid key material length.');
  const pair = keyFromSeed(signing!.key);
  const channelKeys = await channelSuite.DeriveKeyPair(transport!.key);
  const transportPublicKey = Buffer.from(await channelSuite.SerializePublicKey(channelKeys.publicKey)).toString('hex');
  const attest = async (nonce: string): Promise<TeeEvidence> => {
    const binding = { nonce: hashHex.parse(nonce), executorPublicKey: pair.publicKey, transportPublicKey };
    const response = await client.getQuote(reportData(binding));
    return { format: 'neslos-tdx-evidence-v1', ...binding, quote: response.quote.replace(/^0x/, '').toLowerCase(), eventLog: response.event_log };
  };
  const platformInfo = async () => {
    const info = await client.info();
    // Export only public verification inputs, never the complete guest response.
    return { format: 'neslos-platform-info-v1' as const, appId: info.app_id, instanceId: info.instance_id, vmConfig: info.vm_config ?? null };
  };
  return { signingKey: pair.privateKey, executorPublicKey: pair.publicKey, channelKeys, transportPublicKey, auditKey: audit!.key, signingSeed: signing!.key, attest, platformInfo };
}
export function freshChallenge(): string { return randomBytes(32).toString('hex'); }
