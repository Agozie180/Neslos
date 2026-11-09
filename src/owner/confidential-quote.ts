import { QuoteRequest, verifyQuoteSignature, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { z } from 'zod';
import { minimumOutput, units } from '../core/amounts.js';
import { canonical, sha256 } from '../core/crypto.js';
import { hashHex, nearAccount } from '../core/wire.js';

const ASSET = 'nep141:wrap.near';
const REQUEST_LIFETIME_MS = 180_000;
const MAX_QUOTE_AGE_MS = 60_000;
// Observed live owner-proof quotes expire three days after the requested refund deadline.
// Cap that address grace period without extending our local execution window.
const MAX_ADDRESS_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
// Round-trip equality also excludes trailing line breaks accepted by JavaScript's `$` anchor.
const unsignedAmount = z.string().max(39).refine(value => { try { return units(value).toString() === value; } catch { return false; } });
const positiveAmount = unsignedAmount.refine(value => value !== '0');
const decimal = z.string().max(80).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).refine(value => value.trim() === value);
const formattedAmount = z.string().max(65).regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/).refine(value => value.trim() === value);
const account = nearAccount.refine(value => value.trim() === value);
const timestamp = z.iso.datetime().refine(value => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
});
const definedFields = (value: object): boolean => Object.values(value).every(field => field !== undefined);
const emptyList = z.array(z.never()).length(0);
const contextSchema = z.object({
  direction: z.enum(['shield', 'unshield']), ownerAccount: account, confidentialId: hashHex.length(64),
  amount: positiveAmount, dry: z.boolean(), maxLossBps: z.number().int().min(0).max(1000),
}).strict();
export type ConfidentialQuoteContext = z.infer<typeof contextSchema>;

const requestSchema = z.object({
  dry: z.boolean(), swapType: z.literal(QuoteRequest.swapType.EXACT_INPUT), slippageTolerance: z.literal(0),
  originAsset: z.literal(ASSET), destinationAsset: z.literal(ASSET), amount: positiveAmount,
  depositType: z.enum([QuoteRequest.depositType.ORIGIN_CHAIN, QuoteRequest.depositType.CONFIDENTIAL_INTENTS]),
  recipientType: z.enum([QuoteRequest.recipientType.DESTINATION_CHAIN, QuoteRequest.recipientType.CONFIDENTIAL_INTENTS]),
  refundType: z.enum([QuoteRequest.refundType.ORIGIN_CHAIN, QuoteRequest.refundType.CONFIDENTIAL_INTENTS]),
  recipient: account, refundTo: account, deadline: timestamp,
  confidentiality: z.literal(QuoteRequest.confidentiality.ADVANCED),
  // These omitted values have the same harmless defaults as the explicit request.
  depositMode: z.literal(QuoteRequest.depositMode.SIMPLE).optional(), quoteWaitingTimeMs: z.literal(0).optional(),
  appFees: emptyList.optional(), insured: z.literal(false).optional(),
}).strict().refine(definedFields);
const quoteSchema = z.object({
  amountIn: positiveAmount, minAmountIn: positiveAmount, amountOut: positiveAmount, minAmountOut: positiveAmount,
  amountInFormatted: formattedAmount, amountOutFormatted: formattedAmount,
  amountInUsd: decimal, amountOutUsd: decimal, timeEstimate: z.number().finite().nonnegative().max(86400),
  refundFee: unsignedAmount.optional(), withdrawFee: unsignedAmount.optional(),
  depositAddress: account.optional(), deadline: timestamp.optional(), timeWhenInactive: timestamp.optional(),
}).strict().refine(definedFields);
const responseSchema = z.object({
  correlationId: z.string().min(1).max(200), timestamp, signature: z.string().min(1).max(200),
  quoteRequest: requestSchema, quote: quoteSchema,
}).strict();

export type ConfidentialProofQuote = {
  format: 'neslos-confidential-owner-proof-quote-v1';
  direction: ConfidentialQuoteContext['direction'];
  request: QuoteRequest;
  response: QuoteResponse;
  // Local digest of all retained evidence, including fields outside the SDK signature.
  hash: string;
  // Verifies the SDK's signed subset, not every response field or the ADVANCED flag.
  signatureVerified: true;
  amountIn: string;
  amountOut: string;
  principalLoss: string;
  maxLossBps: number;
} & ({
  dry: true;
  execution: null;
  // SDK 0.1.26 excludes fee fields from its dry-quote signature; null means unknown.
  fees: { evidence: 'https-estimate'; refundFee: string | null; withdrawFee: string | null };
} | {
  dry: false;
  execution: {
    depositAddress: string;
    /** Local execution cutoff; cannot outlive the trusted request. */
    deadline: string;
    /** Provider-signed address expiry; does not authorize spending until this time. */
    depositAddressExpiresAt: string;
  };
  fees: { evidence: 'provider-signed'; refundFee: string; withdrawFee: string };
});

function context(input: ConfidentialQuoteContext, now: number): ConfidentialQuoteContext {
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isFinite(new Date(now + REQUEST_LIFETIME_MS).getTime())) throw new Error('CONFIDENTIAL_QUOTE_TIME');
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) throw new Error('CONFIDENTIAL_QUOTE_CONTEXT');
  return parsed.data;
}

function fixedRequest(input: ConfidentialQuoteContext, deadline: string): QuoteRequest {
  const shield = input.direction === 'shield';
  return {
    dry: input.dry, swapType: QuoteRequest.swapType.EXACT_INPUT, slippageTolerance: 0,
    originAsset: ASSET, destinationAsset: ASSET, amount: input.amount,
    depositType: shield ? QuoteRequest.depositType.ORIGIN_CHAIN : QuoteRequest.depositType.CONFIDENTIAL_INTENTS,
    recipientType: shield ? QuoteRequest.recipientType.CONFIDENTIAL_INTENTS : QuoteRequest.recipientType.DESTINATION_CHAIN,
    recipient: shield ? input.confidentialId : input.ownerAccount,
    refundType: shield ? QuoteRequest.refundType.ORIGIN_CHAIN : QuoteRequest.refundType.CONFIDENTIAL_INTENTS,
    refundTo: shield ? input.ownerAccount : input.confidentialId,
    confidentiality: QuoteRequest.confidentiality.ADVANCED, deadline,
    depositMode: QuoteRequest.depositMode.SIMPLE, quoteWaitingTimeMs: 0, appFees: [], insured: false,
  };
}

/** Builds only this owner's same-asset proof request; performs no network or signing operation. */
export function makeConfidentialQuoteRequest(input: ConfidentialQuoteContext, now = Date.now()): QuoteRequest {
  return fixedRequest(context(input, now), new Date(now + REQUEST_LIFETIME_MS).toISOString());
}

function normalizedRequest(request: z.infer<typeof requestSchema>): QuoteRequest {
  return { ...request, depositMode: QuoteRequest.depositMode.SIMPLE, quoteWaitingTimeMs: 0, appFees: [], insured: false };
}

function displayUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 10n ** 24n + BigInt(fraction.padEnd(24, '0'));
}

/**
 * This is owner proof evidence, never a production ValidatedQuote or permission to spend.
 * Both context and request must be trusted local inputs, not the provider's echoed request.
 * SDK 0.1.26 flattens its hash payload: a live quote's address deadline shadows the
 * request deadline. Therefore the echoed live request deadline alone is not signed evidence.
 */
export function validateConfidentialQuote(response: unknown, request: QuoteRequest, input: ConfidentialQuoteContext, now = Date.now()): ConfidentialProofQuote {
  const approved = context(input, now);
  const requested = requestSchema.safeParse(request);
  if (!requested.success) throw new Error('CONFIDENTIAL_QUOTE_REQUEST');
  const requestDeadline = Date.parse(requested.data.deadline);
  if (requestDeadline <= now || requestDeadline > now + REQUEST_LIFETIME_MS || new Date(requestDeadline).toISOString() !== requested.data.deadline) throw new Error('CONFIDENTIAL_QUOTE_DEADLINE');
  const expected = fixedRequest(approved, requested.data.deadline);
  if (canonical(normalizedRequest(requested.data)) !== canonical(expected)) throw new Error('CONFIDENTIAL_QUOTE_CONTEXT_BINDING');

  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new Error('CONFIDENTIAL_QUOTE_RESPONSE');
  const result = parsed.data;
  if (!verifyQuoteSignature(result)) throw new Error('CONFIDENTIAL_QUOTE_SIGNATURE');
  if (canonical(normalizedRequest(result.quoteRequest)) !== canonical(expected)) throw new Error('CONFIDENTIAL_QUOTE_BINDING');
  const quotedAt = Date.parse(result.timestamp);
  if (quotedAt > now + 5000 || now - quotedAt > MAX_QUOTE_AGE_MS || quotedAt >= requestDeadline) throw new Error('CONFIDENTIAL_QUOTE_TIME');

  const quote = result.quote, amountIn = units(quote.amountIn), amountOut = units(quote.amountOut);
  if (quote.amountIn !== approved.amount || quote.minAmountIn !== approved.amount || amountOut > amountIn) throw new Error('CONFIDENTIAL_QUOTE_AMOUNT');
  if (displayUnits(quote.amountInFormatted) !== amountIn || displayUnits(quote.amountOutFormatted) !== amountOut) throw new Error('CONFIDENTIAL_QUOTE_DISPLAY');
  if (quote.minAmountOut !== quote.amountOut) throw new Error('CONFIDENTIAL_QUOTE_SLIPPAGE');
  const minimumPrincipal = units(minimumOutput(approved.amount, approved.maxLossBps));
  const lossBudget = amountIn - minimumPrincipal;
  // amountOut already includes withdrawFee; do not subtract it twice. Refund is an
  // alternative outcome, but both declared fees must independently fit the owner's cap.
  if (amountOut < minimumPrincipal || [quote.refundFee, quote.withdrawFee].some(fee => fee !== undefined && units(fee) > lossBudget)) throw new Error('CONFIDENTIAL_QUOTE_LOSS');

  const base = {
    format: 'neslos-confidential-owner-proof-quote-v1' as const, direction: approved.direction,
    request: normalizedRequest(requested.data), response: result, hash: sha256(canonical(result)), signatureVerified: true as const,
    amountIn: quote.amountIn, amountOut: quote.amountOut, principalLoss: (amountIn - amountOut).toString(), maxLossBps: approved.maxLossBps,
  };
  if (approved.dry) {
    if (['depositAddress', 'deadline', 'timeWhenInactive'].some(field => Object.hasOwn(quote, field))) throw new Error('CONFIDENTIAL_QUOTE_DRY_EXECUTION');
    return { ...base, dry: true, execution: null, fees: { evidence: 'https-estimate', refundFee: quote.refundFee ?? null, withdrawFee: quote.withdrawFee ?? null } };
  }
  if (quote.refundFee === undefined || quote.withdrawFee === undefined) throw new Error('CONFIDENTIAL_QUOTE_FEES');
  const addressExpiry = Date.parse(quote.deadline ?? '');
  if (!quote.depositAddress || !Number.isFinite(addressExpiry) || addressExpiry <= now || addressExpiry > requestDeadline + MAX_ADDRESS_GRACE_MS ||
    (quote.timeWhenInactive !== undefined && Date.parse(quote.timeWhenInactive) > addressExpiry)) throw new Error('CONFIDENTIAL_QUOTE_EXECUTION');
  return {
    ...base, dry: false,
    execution: { depositAddress: quote.depositAddress, deadline: new Date(Math.min(requestDeadline, addressExpiry)).toISOString(), depositAddressExpiresAt: quote.deadline! },
    fees: { evidence: 'provider-signed', refundFee: quote.refundFee, withdrawFee: quote.withdrawFee },
  };
}
