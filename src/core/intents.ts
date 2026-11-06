import { QuoteRequest, verifyQuoteSignature, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { z } from 'zod';
import { canonical, sha256 } from './crypto.js';
import { minimumOutput, units } from './amounts.js';
import { fetchJson, NATIVE_USDC } from './research.js';
import { nearAccount } from './wire.js';

export const ONECLICK_URL = 'https://1click.chaindefuser.com/v0';
const tokenSchema = z.object({ assetId: z.string().min(1).max(200), blockchain: z.string(), symbol: z.string(), decimals: z.number().int().min(0).max(30), contractAddress: z.string().nullish() }).passthrough();
export interface QuoteParameters { amount: string; maxSlippageBps: number; recipient: string; refundTo: string; dry: boolean; destinationAsset?: string }
export interface ValidatedQuote { response: QuoteResponse; hash: string; signatureVerified: true; privacyBinding: 'signed-confidential-recipient'; requestedSlippageBps: number; enforcedSlippageBps: number; fetchedAt: string }
/** Quote/status credentials identify the integration. A User-Session access token belongs only on account read APIs. */
export interface OneClickPartnerAuth { kind: 'partner-jwt'; token: string }
const partnerAuthSchema = z.object({ kind: z.literal('partner-jwt'), token: z.string().min(1).max(32768).regex(/^\S+$/) }).strict();

/** Validate every security-relevant echo in addition to the provider's cryptographic signature. */
export function validateQuote(response: QuoteResponse, request: QuoteRequest, maxSlippageBps: number, now = Date.now()): ValidatedQuote {
  if (!verifyQuoteSignature(response)) throw new Error('QUOTE_SIGNATURE: provider signature verification failed.');
  const r = response.quoteRequest, q = response.quote;
  for (const field of ['dry', 'swapType', 'originAsset', 'destinationAsset', 'amount', 'depositType', 'refundTo', 'refundType', 'recipient', 'recipientType', 'deadline', 'slippageTolerance'] as const) {
    if (r[field] !== request[field]) throw new Error(`QUOTE_BINDING: ${field} changed.`);
  }
  // SDK 0.1.26 does not sign the confidentiality flag. Require the signed recipientType rail.
  if (r.recipientType !== QuoteRequest.recipientType.CONFIDENTIAL_INTENTS || r.confidentiality !== request.confidentiality) throw new Error('CONFIDENTIAL_RAIL: confidential recipient routing is required.');
  if (r.customRecipientMsg || r.virtualChainRecipient || r.virtualChainRefundRecipient || q.customRecipientMsg || q.virtualChainRecipient || q.virtualChainRefundRecipient) throw new Error('UNSUPPORTED_ROUTING: no alternate recipient instructions are accepted.');
  if (units(q.amountIn) !== units(request.amount) || units(q.minAmountIn) > units(request.amount)) throw new Error('QUOTE_AMOUNT: the exact input changed.');
  if (units(q.amountOut) === 0n || units(q.minAmountOut) < units(minimumOutput(q.amountOut, maxSlippageBps)) || units(q.minAmountOut) > units(q.amountOut)) throw new Error('QUOTE_FLOOR: the signed minimum breaches the hard slippage limit.');
  const quotedAt = Date.parse(response.timestamp);
  if (!Number.isFinite(quotedAt) || quotedAt > now + 5_000 || now - quotedAt > 60_000) throw new Error('STALE_QUOTE: the provider timestamp is outside its freshness window.');
  if (q.depositMemo) throw new Error('UNSUPPORTED_MEMO: the NEAR vault only sends simple FT transfers.');
  if (request.dry) {
    if (q.depositAddress) throw new Error('DRY_QUOTE: unexpected executable deposit address.');
  } else {
    nearAccount.parse(q.depositAddress);
    const deadline = Date.parse(q.deadline ?? '');
    if (!Number.isFinite(deadline) || deadline <= now || deadline > Date.parse(request.deadline)) throw new Error('QUOTE_DEADLINE: invalid deposit expiry.');
  }
  return { response, hash: sha256(canonical(response)), signatureVerified: true, privacyBinding: 'signed-confidential-recipient', requestedSlippageBps: request.slippageTolerance, enforcedSlippageBps: maxSlippageBps, fetchedAt: new Date(now).toISOString() };
}

export class IntentsClient {
  #partnerJwt?: string;
  constructor(auth?: OneClickPartnerAuth) {
    const candidate = auth ?? (process.env.ONECLICK_JWT ? { kind: 'partner-jwt', token: process.env.ONECLICK_JWT } : undefined);
    if (candidate !== undefined) {
      const parsed = partnerAuthSchema.safeParse(candidate);
      if (!parsed.success) throw new Error('ONECLICK_PARTNER_AUTH_CONFIG: quote credentials must be a partner JWT.');
      this.#partnerJwt = parsed.data.token;
    }
  }
  private partnerHeaders(): Record<string, string> { return this.#partnerJwt ? { 'X-API-Key': this.#partnerJwt } : {}; }
  async quote(params: QuoteParameters): Promise<ValidatedQuote> {
    if (units(params.amount) <= 0n || !Number.isSafeInteger(params.maxSlippageBps) || params.maxSlippageBps < 0 || params.maxSlippageBps > 1000) throw new Error('Invalid amount or slippage.');
    nearAccount.parse(params.refundTo); nearAccount.parse(params.recipient);
    const tokens = z.array(tokenSchema).max(20_000).parse(await fetchJson(`${ONECLICK_URL}/tokens`, {}, 8_000_000));
    const origin = tokens.find(t => t.blockchain.toLowerCase() === 'near' && t.assetId === `nep141:${NATIVE_USDC}` && t.decimals === 6);
    const destination = tokens.find(t => t.blockchain.toLowerCase() === 'near' && t.assetId === (params.destinationAsset ?? 'nep141:usdt.tether-token.near'));
    if (!origin || !destination) throw new Error('TOKEN_DISCOVERY: the required NEAR assets were not returned by 1Click.');
    const request: QuoteRequest = {
      dry: params.dry, swapType: QuoteRequest.swapType.EXACT_INPUT, slippageTolerance: Math.max(0, params.maxSlippageBps - 1),
      originAsset: origin.assetId, destinationAsset: destination.assetId, amount: params.amount,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN, refundTo: params.refundTo, refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: params.recipient, recipientType: QuoteRequest.recipientType.CONFIDENTIAL_INTENTS,
      confidentiality: QuoteRequest.confidentiality.ADVANCED, deadline: new Date(Date.now() + 180_000).toISOString(),
    };
    const response = await fetchJson(`${ONECLICK_URL}/quote`, { method: 'POST', headers: { 'content-type': 'application/json', ...this.partnerHeaders() }, body: JSON.stringify(request) }) as QuoteResponse;
    return validateQuote(response, request, params.maxSlippageBps);
  }
  async status(quote: ValidatedQuote): Promise<{ outcome: 'pending' | 'success' | 'refunded' | 'failed' | 'unknown'; raw: unknown }> {
    if (quote.response.quoteRequest.dry || !quote.response.quote.depositAddress) throw new Error('A dry quote cannot settle.');
    const address = nearAccount.parse(quote.response.quote.depositAddress);
    try {
      const raw = await fetchJson(`${ONECLICK_URL}/status?depositAddress=${encodeURIComponent(address)}`, { headers: this.partnerHeaders() });
      const result = z.object({ status: z.string(), quoteResponse: z.unknown() }).parse(raw);
      const signed = result.quoteResponse as QuoteResponse;
      if (!verifyQuoteSignature(signed) || sha256(canonical(signed)) !== quote.hash) throw new Error('Status refers to a different or unsigned quote.');
      // A Map cannot accidentally resolve prototype properties from an unknown status.
      const outcomes = new Map<string, 'pending' | 'success' | 'refunded' | 'failed'>([
        ['SUCCESS', 'success'], ['REFUNDED', 'refunded'], ['FAILED', 'failed'],
        ['PENDING_DEPOSIT', 'pending'], ['KNOWN_DEPOSIT_TX', 'pending'],
        ['PROCESSING', 'pending'], ['INCOMPLETE_DEPOSIT', 'pending'],
      ]);
      return { outcome: outcomes.get(result.status) ?? 'unknown', raw };
    } catch { return { outcome: 'unknown', raw: null }; }
  }
}
