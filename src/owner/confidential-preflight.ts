import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { nearAccount } from '../core/wire.js';
import { writePrivateJson } from './account.js';
import { confidentialImplicitId } from './confidential-auth.js';
import { validateConfidentialWithdrawalIntent, type ConfidentialWithdrawalIntent } from './confidential-intent.js';
import { makeConfidentialQuoteRequest, validateConfidentialQuote, type ConfidentialProofQuote, type ConfidentialQuoteContext } from './confidential-quote.js';

const API = 'https://1click.chaindefuser.com/v0';
const AMOUNT = '1000000000000000000000'; // Fixed 0.001 wNEAR quote; this helper never funds it.
const MAX_RESPONSE_BYTES = 131072;
const inputSchema = z.object({
  ownerAccount: nearAccount.refine(value => value.trim() === value), publicKey: z.string().min(1).max(100),
  mode: z.enum(['dry', 'live']).default('dry'), maxLossBps: z.number().int().min(0).max(1000).default(0),
  out: z.string().min(1).max(4096).refine(value => value.trim().length > 0 && !value.includes('\0')),
}).strict();

export type ConfidentialPreflightOptions = z.input<typeof inputSchema>;
export type ConfidentialPreflightFailureCode =
  | 'CONFIDENTIAL_PREFLIGHT_ARGUMENTS' | 'CONFIDENTIAL_PREFLIGHT_INPUT'
  | 'CONFIDENTIAL_PREFLIGHT_CREDENTIALS' | 'CONFIDENTIAL_PREFLIGHT_SESSION' | 'CONFIDENTIAL_PREFLIGHT_IDENTITY'
  | 'CONFIDENTIAL_PREFLIGHT_PARTNER_AUTH_REQUIRED' | 'CONFIDENTIAL_PREFLIGHT_OUTPUT_EXISTS'
  | 'CONFIDENTIAL_PREFLIGHT_OUTPUT_UNAVAILABLE' | 'CONFIDENTIAL_PREFLIGHT_SAVE_FAILED'
  | 'CONFIDENTIAL_PREFLIGHT_HTTP' | 'CONFIDENTIAL_PREFLIGHT_NETWORK'
  | 'CONFIDENTIAL_PREFLIGHT_EMPTY_RESPONSE' | 'CONFIDENTIAL_PREFLIGHT_RESPONSE_TOO_LARGE'
  | 'CONFIDENTIAL_PREFLIGHT_RESPONSE_READ' | 'CONFIDENTIAL_PREFLIGHT_INVALID_JSON'
  | 'CONFIDENTIAL_PREFLIGHT_QUOTE_INVALID' | 'CONFIDENTIAL_PREFLIGHT_INTENT_INVALID'
  | 'CONFIDENTIAL_PREFLIGHT_FAILED';

/** Error properties are deliberately limited to local labels and an HTTP status. */
export class ConfidentialPreflightError extends Error {
  constructor(readonly code: ConfidentialPreflightFailureCode, readonly savedPrivately = false, readonly httpStatus?: number) {
    super(code); this.name = 'ConfidentialPreflightError';
  }
}

/** Safe for stdout/stderr even when an upstream error includes a key, address or payload. */
export function confidentialPreflightFailure(error: unknown) {
  const known = error instanceof ConfidentialPreflightError ? error : new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_FAILED');
  return {
    failure: known.code, savedPrivately: known.savedPrivately,
    ...(known.httpStatus === undefined ? {} : { httpStatus: known.httpStatus }), signatures: 0 as const, transactions: 0 as const,
  };
}

type Exchange = {
  endpoint: '/quote' | '/generate-intent'; direction: 'shield' | 'unshield'; request: unknown;
  response?: { httpStatus: number; bodyBase64: string; bodyBytes: number; truncated: boolean; body?: unknown };
  quote?: ConfidentialProofQuote;
};
type Evidence = {
  format: 'neslos-confidential-preflight-v1'; checkedAt: string; mode: 'dry' | 'live';
  owner: { ownerAccount: string; publicKey: string; confidentialId: string };
  asset: 'nep141:wrap.near'; amount: string; maxLossBps: number; signatures: 0; transactions: 0;
  exchanges: Exchange[]; state: 'failed' | 'validated';
  recoveryIntent?: ConfidentialWithdrawalIntent; failure?: { code: ConfidentialPreflightFailureCode; httpStatus?: number };
};

async function assertUnusedOutput(path: string) {
  try { await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_OUTPUT_UNAVAILABLE');
  }
  throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_OUTPUT_EXISTS');
}

async function boundedResponse(response: Response, exchange: Exchange) {
  const captured = { httpStatus: response.status, bodyBase64: '', bodyBytes: 0, truncated: false, body: undefined as unknown };
  exchange.response = captured;
  if (!response.body) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_EMPTY_RESPONSE');
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_RESPONSE_BYTES - captured.bodyBytes;
      chunks.push(Buffer.from(value.subarray(0, remaining)));
      captured.bodyBytes += Math.min(value.length, remaining);
      if (value.length > remaining) {
        captured.truncated = true;
        await reader.cancel().catch(() => {});
        throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_RESPONSE_TOO_LARGE');
      }
    }
  } catch (error) {
    if (error instanceof ConfidentialPreflightError) throw error;
    throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_RESPONSE_READ');
  } finally {
    captured.bodyBase64 = Buffer.concat(chunks).toString('base64');
    reader.releaseLock();
  }
  try {
    captured.body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
    return captured.body;
  } catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_INVALID_JSON'); }
}

async function post(exchange: Exchange, partnerJwt: string, fetchImpl: typeof fetch) {
  let response: Response;
  try {
    response = await fetchImpl(API + exchange.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': partnerJwt },
      body: JSON.stringify(exchange.request),
    });
  } catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_NETWORK'); }
  // Capture bounded error bodies too. No upstream text is used in an external error.
  let body: unknown;
  try { body = await boundedResponse(response, exchange); }
  catch (error) {
    if (response.status !== 200 && response.status !== 201) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_HTTP', false, response.status);
    throw error;
  }
  if (response.status !== 200 && response.status !== 201) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_HTTP', false, response.status);
  return body;
}

/**
 * Read-only owner proof. Only public identity is accepted, and the partner JWT is
 * read internally. The fixed endpoint set has no sign, deposit or submit method.
 * Raw provider bytes and validated payloads are returned only in an exclusive
 * private evidence file, including when a quote or recovery intent is refused.
 */
export async function runConfidentialPreflight(input: ConfidentialPreflightOptions, fetchImpl: typeof fetch = fetch) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_INPUT');
  const { ownerAccount, publicKey, mode, maxLossBps } = parsed.data;
  let confidentialId: string;
  try { confidentialId = confidentialImplicitId(publicKey); }
  catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_IDENTITY'); }
  const out = resolve(parsed.data.out);
  await assertUnusedOutput(out);
  const evidence: Evidence = {
    format: 'neslos-confidential-preflight-v1', checkedAt: new Date().toISOString(), mode,
    owner: { ownerAccount, publicKey, confidentialId }, asset: 'nep141:wrap.near', amount: AMOUNT,
    maxLossBps, signatures: 0, transactions: 0, exchanges: [], state: 'failed',
  };
  let failure: ConfidentialPreflightError | undefined;
  try {
    const partnerJwt = process.env.ONECLICK_JWT;
    if (!partnerJwt || partnerJwt.length > 32768 || !/^[!-~]+$/.test(partnerJwt)) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_PARTNER_AUTH_REQUIRED');
    let unshield: ConfidentialProofQuote | undefined;
    for (const direction of ['shield', 'unshield'] as const) {
      const context: ConfidentialQuoteContext = { direction, ownerAccount, confidentialId, amount: AMOUNT, dry: mode === 'dry', maxLossBps };
      const request = makeConfidentialQuoteRequest(context);
      const exchange: Exchange = { endpoint: '/quote', direction, request };
      evidence.exchanges.push(exchange);
      const response = await post(exchange, partnerJwt, fetchImpl);
      try { exchange.quote = validateConfidentialQuote(response, request, context); }
      catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_QUOTE_INVALID'); }
      if (direction === 'unshield') unshield = exchange.quote;
    }
    if (mode === 'live') {
      if (!unshield || unshield.dry || !unshield.execution) throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_QUOTE_INVALID');
      const exchange: Exchange = { endpoint: '/generate-intent', direction: 'unshield', request: {
        type: 'swap_transfer', standard: 'raw_ed25519', signerId: confidentialId, depositAddress: unshield.execution.depositAddress,
      } };
      evidence.exchanges.push(exchange);
      const response = await post(exchange, partnerJwt, fetchImpl);
      try { evidence.recoveryIntent = validateConfidentialWithdrawalIntent(response, unshield, { ownerAccount, confidentialId, publicKey, amount: AMOUNT, maxLossBps }); }
      catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_INTENT_INVALID'); }
    }
    evidence.state = 'validated';
  } catch (error) {
    failure = error instanceof ConfidentialPreflightError ? error : new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_FAILED');
    evidence.failure = { code: failure.code, ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }) };
  }
  try { await writePrivateJson(out, evidence, true); }
  catch { throw new ConfidentialPreflightError('CONFIDENTIAL_PREFLIGHT_SAVE_FAILED'); }
  if (failure) throw new ConfidentialPreflightError(failure.code, true, failure.httpStatus);
  return {
    mode, quoteAsset: 'wNEAR' as const, quoteAmount: '0.001' as const, maxLossBps,
    shieldQuoteValidated: true as const, unshieldQuoteValidated: true as const,
    unsignedRecoveryIntentValidated: mode === 'live', savedPrivately: true as const, signatures: 0 as const, transactions: 0 as const,
  };
}
