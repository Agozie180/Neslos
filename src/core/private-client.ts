import { channelSuite, decryptChannel, encryptChannel, envelopeSchema } from './channel.js';
import { freshChallenge, verifyTeeEvidence, type TeePolicy } from './attestation.js';
import { canonical, sha256, verifyHash } from './crypto.js';
import { fetchJson } from './research.js';
import { z } from 'zod';
import { hashHex } from './wire.js';

export async function attestEndpoint(endpoint: string, pinned: TeePolicy, expectedExecutor?: string) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('A plain HTTPS enclave endpoint is required.');
  const base = endpoint.replace(/\/$/, ''), nonce = freshChallenge(), started = Date.now();
  const evidence = await fetchJson(base + '/attestation/' + nonce, {}, 700_000);
  const identity = await verifyTeeEvidence(evidence, pinned, nonce);
  if (Date.now() - started > 60_000) throw new Error('Attestation challenge expired.');
  if (expectedExecutor && identity.executorPublicKey !== hashHex.parse(expectedExecutor)) throw new Error('ATTESTED_EXECUTOR_CHANGED');
  return { base, nonce, evidence, identity };
}

export async function privateCommand(endpoint: string, pinned: TeePolicy, ownerToken: string, command: unknown, expectedExecutor?: string) {
  hashHex.parse(ownerToken);
  const { base, nonce, identity } = await attestEndpoint(endpoint, pinned, expectedExecutor);
  const replyKeys = await channelSuite.GenerateKeyPair();
  const replyKey = Buffer.from(await channelSuite.SerializePublicKey(replyKeys.publicKey)).toString('hex');
  const envelope = await encryptChannel(identity.transportPublicKey, { ownerToken, command, replyKey, expiresAt: Date.now() + 60_000 }, { domain: 'neslos:request:v1', nonce });
  const raw = await fetchJson(base + '/private', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(120_000), body: JSON.stringify({ nonce, envelope }) }, 700_000);
  const response = z.object({ nonce: hashHex, envelope: envelopeSchema, signature: z.string().regex(/^[a-f0-9]{128}$/) }).strict().parse(raw);
  if (response.nonce !== nonce || !verifyHash(sha256(canonical({ nonce, envelope: response.envelope })), response.signature, identity.executorPublicKey)) throw new Error('Private response did not come from the attested executor.');
  return decryptChannel(replyKeys, response.envelope, { domain: 'neslos:response:v1', nonce });
}
