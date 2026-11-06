import { randomBytes } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { baseDecode, baseEncode, type KeyPair } from 'near-api-js';
import { z } from 'zod';
import { canonical, sha256 } from '../core/crypto.js';
import { units } from '../core/amounts.js';
import { writePrivateJson } from './account.js';

const API = 'https://1click.chaindefuser.com/v0';
const MAINNET_RPC = 'https://rpc.fastnear.com';
const CONTRACT = 'intents.near';
const MAGIC = Buffer.from([0x56, 0x28, 0xf6, 0xc6]);
const MAX_AUTH_MS = 180_000;
const implicitId = z.string().regex(/^[a-f0-9]{64}$/);
const authPayloadSchema = z.object({ signer_id: implicitId, verifying_contract: z.literal(CONTRACT), deadline: z.iso.datetime(), nonce: z.string(), intents: z.tuple([]) }).strict();
type AuthSigner = Pick<KeyPair, 'getPublicKey' | 'sign' | 'verify'>;

export type ConfidentialAuthFailureCode = 'TIMESTAMP_VALIDATION_FAILED' | 'INVALID_NONCE' | 'SIGNATURE_VERIFICATION_FAILED' | 'INVALID_SIGNED_DATA' | 'PARTNER_AUTH_REQUIRED' | 'PARTNER_AUTH_INVALID' | 'USER_AUTH_REQUIRED' | 'UNAUTHORIZED' | 'UNCLASSIFIED';
export type ConfidentialAuthDiagnostics = { httpStatus: number; providerCode: ConfidentialAuthFailureCode };
export class ConfidentialAuthHttpError extends Error {
  constructor(readonly status: number, readonly diagnostic?: ConfidentialAuthDiagnostics) { super('CONFIDENTIAL_AUTH_HTTP_' + status); this.name = 'ConfidentialAuthHttpError'; }
}

/** Returns only fixed local labels. No provider text, token, key, payload or signature can escape. */
export function classifyConfidentialAuthFailure(body: unknown): ConfidentialAuthFailureCode {
  const record = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const values = [record.message, record.code, record.error].flatMap(value => Array.isArray(value) ? value.slice(0, 8) : [value]);
  const message = values.filter((value): value is string => typeof value === 'string').map(value => value.slice(0, 4096).toLowerCase()).join(' ');
  if (message.includes('timestamp validation failed')) return 'TIMESTAMP_VALIDATION_FAILED';
  if (message.includes('invalid nonce')) return 'INVALID_NONCE';
  if (message.includes('signature verification failed')) return 'SIGNATURE_VERIFICATION_FAILED';
  if (message.includes('invalid signed data') || message.includes('signeddata should not be empty') || message.includes('signeddata must be')) return 'INVALID_SIGNED_DATA';
  if (/(?:api[ -]?key|jwt|partner).{0,60}(?:required|missing)/.test(message) || /(?:missing|required).{0,60}(?:api[ -]?key|jwt|partner)/.test(message)) return 'PARTNER_AUTH_REQUIRED';
  if (/(?:api[ -]?key|jwt|partner).{0,60}(?:invalid|expired)/.test(message) || /(?:invalid|expired).{0,60}(?:api[ -]?key|jwt|partner)/.test(message)) return 'PARTNER_AUTH_INVALID';
  if (message.includes('user authentication is required')) return 'USER_AUTH_REQUIRED';
  if (message.includes('unauthorized')) return 'UNAUTHORIZED';
  return 'UNCLASSIFIED';
}

/** Same existing user-held Ed25519 key, with its implicit Intents identity; no account creation. */
export function confidentialImplicitId(publicKey: string) {
  if (!publicKey.startsWith('ed25519:')) throw new Error('CONFIDENTIAL_AUTH_ED25519_REQUIRED');
  const bytes = Buffer.from(baseDecode(publicKey.slice(8)));
  if (bytes.length !== 32 || baseEncode(bytes) !== publicKey.slice(8)) throw new Error('CONFIDENTIAL_AUTH_PUBLIC_KEY');
  return bytes.toString('hex');
}

/** SDK VersionedNonceBuilder v0: magic(4), version(1), salt(4), deadlineNs(8 LE), startNs(8 LE), entropy(7). */
export function makeConfidentialAuthPayload(publicKey: string, saltHex: string, now = Date.now(), entropy: Uint8Array = randomBytes(7)) {
  if (!Number.isSafeInteger(now) || now <= 0 || entropy.length !== 7) throw new Error('CONFIDENTIAL_AUTH_CLOCK_OR_NONCE');
  if (!/^[a-f0-9]{8}$/.test(saltHex)) throw new Error('CONFIDENTIAL_AUTH_SALT');
  const expires = now + MAX_AUTH_MS, nonce = Buffer.alloc(32);
  MAGIC.copy(nonce); nonce[4] = 0; Buffer.from(saltHex, 'hex').copy(nonce, 5);
  nonce.writeBigUInt64LE(BigInt(expires) * 1_000_000n, 9);
  nonce.writeBigUInt64LE(BigInt(now) * 1_000_000n, 17);
  Buffer.from(entropy).copy(nonce, 25);
  return canonical({ signer_id: confidentialImplicitId(publicKey), verifying_contract: CONTRACT, deadline: new Date(expires).toISOString(), nonce: nonce.toString('base64'), intents: [] });
}

/** Strictly empty, current, fixed-audience authentication. Called immediately before the only signing operation. */
export function assertConfidentialAuthPayload(payload: string, publicKey: string, expectedRecipient: string, saltHex: string, now = Date.now()) {
  if (!/^[a-f0-9]{8}$/.test(saltHex)) throw new Error('CONFIDENTIAL_AUTH_SALT');
  let parsed: z.infer<typeof authPayloadSchema>;
  try { parsed = authPayloadSchema.parse(JSON.parse(payload)); } catch { throw new Error('CONFIDENTIAL_AUTH_PAYLOAD'); }
  if (canonical(parsed) !== payload || parsed.signer_id !== confidentialImplicitId(publicKey) || parsed.signer_id !== implicitId.parse(expectedRecipient)) throw new Error('CONFIDENTIAL_AUTH_IDENTITY');
  const nonce = Buffer.from(parsed.nonce, 'base64');
  if (nonce.length !== 32 || nonce.toString('base64') !== parsed.nonce || !nonce.subarray(0, 4).equals(MAGIC) || nonce[4] !== 0 || !nonce.subarray(5, 9).equals(Buffer.from(saltHex, 'hex'))) throw new Error('CONFIDENTIAL_AUTH_NONCE');
  const deadline = Date.parse(parsed.deadline), deadlineNs = nonce.readBigUInt64LE(9), startNs = nonce.readBigUInt64LE(17), nowNs = BigInt(now) * 1_000_000n;
  if (deadlineNs !== BigInt(deadline) * 1_000_000n || startNs > nowNs || nowNs - startNs > 60_000_000_000n || deadline <= now || deadlineNs - startNs !== BigInt(MAX_AUTH_MS) * 1_000_000n) throw new Error('CONFIDENTIAL_AUTH_TIME');
  return parsed;
}

const apiSessionSchema = z.object({ accessToken: z.string().min(1).max(32768), refreshToken: z.string().min(1).max(32768), expiresIn: z.number().int().positive().max(604800), refreshExpiresIn: z.number().int().positive().max(31536000) });
const sessionSchema = z.object({ format: z.literal('neslos-confidential-user-session-v1'), recipient: implicitId, publicKey: z.string(), authPayloadHash: z.string().regex(/^[a-f0-9]{64}$/), receivedAt: z.iso.datetime(), accessExpiresAt: z.iso.datetime(), refreshExpiresAt: z.iso.datetime(), accessToken: z.string().min(1).max(32768), refreshToken: z.string().min(1).max(32768) }).strict();

async function boundedJson(response: Response) {
  if (!response.body) throw new Error('CONFIDENTIAL_AUTH_EMPTY_RESPONSE');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 131072) { await reader.cancel(); throw new Error('CONFIDENTIAL_AUTH_RESPONSE_TOO_LARGE'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new Error('CONFIDENTIAL_AUTH_INVALID_RESPONSE'); }
}

/** The nonce salt rotates: read current_salt at finalized mainnet state, never use a documentation constant. */
export async function fetchConfidentialNonceSalt(fetchImpl: typeof fetch = fetch) {
  let networkResponse: Response;
  try { networkResponse = await fetchImpl(MAINNET_RPC, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'confidential-auth-network', method: 'status', params: [] }) }); }
  catch { throw new Error('CONFIDENTIAL_AUTH_NETWORK_UNAVAILABLE'); }
  if (networkResponse.status !== 200) { await networkResponse.body?.cancel(); throw new Error('CONFIDENTIAL_AUTH_NETWORK_HTTP_' + networkResponse.status); }
  try { z.object({ jsonrpc: z.literal('2.0'), id: z.literal('confidential-auth-network'), result: z.object({ chain_id: z.literal('mainnet') }) }).parse(await boundedJson(networkResponse)); }
  catch { throw new Error('CONFIDENTIAL_AUTH_NETWORK_INVALID'); }
  let response: Response;
  try {
    response = await fetchImpl(MAINNET_RPC, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'confidential-auth-salt', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: 'current_salt', args_base64: 'e30=' } }),
    });
  } catch { throw new Error('CONFIDENTIAL_AUTH_SALT_UNAVAILABLE'); }
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('CONFIDENTIAL_AUTH_SALT_HTTP_' + response.status); }
  try {
    const rpc = z.object({ jsonrpc: z.literal('2.0'), id: z.literal('confidential-auth-salt'), result: z.object({ block_height: z.number().int().positive(), block_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), result: z.array(z.number().int().min(0).max(255)).length(10) }) }).parse(await boundedJson(response));
    return z.string().regex(/^[a-f0-9]{8}$/).parse(JSON.parse(Buffer.from(rpc.result.result).toString('utf8')));
  } catch { throw new Error('CONFIDENTIAL_AUTH_SALT_INVALID'); }
}

/** Signs only an empty ownership proof, posts only to auth, saves bearer tokens privately, returns no token/signature. */
export async function authenticateConfidentialOwner(signer: AuthSigner, expectedRecipient: string, sessionFile: string, fetchImpl: typeof fetch = fetch, options: { includeErrorCode?: boolean } = {}) {
  try { await access(sessionFile); throw new Error('CONFIDENTIAL_AUTH_SESSION_EXISTS'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const publicKey = signer.getPublicKey().toString();
  if (confidentialImplicitId(publicKey) !== implicitId.parse(expectedRecipient)) throw new Error('CONFIDENTIAL_AUTH_IDENTITY');
  const saltHex = await fetchConfidentialNonceSalt(fetchImpl), payload = makeConfidentialAuthPayload(publicKey, saltHex);
  assertConfidentialAuthPayload(payload, publicKey, expectedRecipient, saltHex);
  // Raw Ed25519 signs the UTF-8 payload itself. SHA256(payload) is its identifier, not its signing message.
  // Confirmed in near/intents contracts/defuse/core/src/payload/raw.rs::SignedPayload::verify.
  const message = Buffer.from(payload, 'utf8'), signed = signer.sign(message);
  if (signed.publicKey.toString() !== publicKey || !signer.verify(message, signed.signature)) throw new Error('CONFIDENTIAL_AUTH_SIGNATURE');
  const signedData = { standard: 'raw_ed25519', payload, public_key: publicKey, signature: 'ed25519:' + baseEncode(signed.signature) };
  let response: Response;
  try { response = await fetchImpl(API + '/auth/authenticate', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ signedData }) }); }
  catch { throw new Error('CONFIDENTIAL_AUTH_UNAVAILABLE'); }
  if (response.status !== 200 && response.status !== 201) {
    let diagnostic: ConfidentialAuthDiagnostics | undefined;
    if (options.includeErrorCode) {
      let providerCode: ConfidentialAuthFailureCode = 'UNCLASSIFIED';
      try { providerCode = classifyConfidentialAuthFailure(await boundedJson(response)); } catch { /* Unparseable or excessive bodies stay redacted. */ }
      diagnostic = { httpStatus: response.status, providerCode };
    } else await response.body?.cancel();
    throw new ConfidentialAuthHttpError(response.status, diagnostic);
  }
  let auth: z.infer<typeof apiSessionSchema>;
  try { auth = apiSessionSchema.parse(await boundedJson(response)); } catch { throw new Error('CONFIDENTIAL_AUTH_INVALID_RESPONSE'); }
  const receivedAt = Date.now(), accessExpiresAt = new Date(receivedAt + auth.expiresIn * 1000).toISOString(), refreshExpiresAt = new Date(receivedAt + auth.refreshExpiresIn * 1000).toISOString();
  await writePrivateJson(sessionFile, sessionSchema.parse({ format: 'neslos-confidential-user-session-v1', recipient: expectedRecipient, publicKey, authPayloadHash: sha256(payload), receivedAt: new Date(receivedAt).toISOString(), accessExpiresAt, refreshExpiresAt, accessToken: auth.accessToken, refreshToken: auth.refreshToken }), true);
  return { recipient: expectedRecipient, publicKey, authenticated: true, noSpendIntent: true, authPayloadHash: sha256(payload), accessExpiresAt, refreshExpiresAt, sessionFile };
}

/** Private read only. This helper has no transaction, deposit, generate-intent or submit-intent method. */
export async function readConfidentialOwnerBalances(sessionFile: string, expectedRecipient: string, fetchImpl: typeof fetch = fetch) {
  let session: z.infer<typeof sessionSchema>;
  try { session = sessionSchema.parse(JSON.parse(await readFile(sessionFile, 'utf8'))); } catch { throw new Error('CONFIDENTIAL_AUTH_SESSION_INVALID'); }
  if (session.recipient !== implicitId.parse(expectedRecipient) || confidentialImplicitId(session.publicKey) !== expectedRecipient) throw new Error('CONFIDENTIAL_AUTH_IDENTITY');
  if (Date.parse(session.accessExpiresAt) <= Date.now()) throw new Error('CONFIDENTIAL_AUTH_SESSION_EXPIRED');
  let response: Response;
  try { response = await fetchImpl(API + '/account/balances?tokenIds=nep141%3Awrap.near', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { authorization: 'Bearer ' + session.accessToken, accept: 'application/json' } }); }
  catch { throw new Error('CONFIDENTIAL_BALANCE_UNAVAILABLE'); }
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('CONFIDENTIAL_BALANCE_HTTP_' + response.status); }
  const balance = z.object({ tokenId: z.literal('nep141:wrap.near'), available: z.string().refine(v => { try { units(v); return true; } catch { return false; } }), source: z.literal('private') }).strict();
  try { return { recipient: expectedRecipient, ...z.object({ balances: z.array(balance).max(1) }).strict().parse(await boundedJson(response)) }; }
  catch { throw new Error('CONFIDENTIAL_BALANCE_INVALID_RESPONSE'); }
}
