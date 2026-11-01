import { describe, expect, it } from 'vitest';
import { QuoteRequest, quoteHash, verifyQuoteSignature, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { validateQuote } from '../src/core/intents.js';
const request: QuoteRequest = {
  dry: true, swapType: QuoteRequest.swapType.EXACT_INPUT, slippageTolerance: 49, originAsset: 'nep141:usdc-test-fixture',
  destinationAsset: 'nep141:usdt-test-fixture', amount: '150000000', depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
  refundTo: 'vault.near', refundType: QuoteRequest.refundType.ORIGIN_CHAIN, recipient: 'recipient.near',
  recipientType: QuoteRequest.recipientType.CONFIDENTIAL_INTENTS, confidentiality: QuoteRequest.confidentiality.ADVANCED,
  deadline: '2026-11-01T12:03:00.000Z',
};
const synthetic: QuoteResponse = {
  correlationId: 'synthetic-test-only', timestamp: '2026-11-01T12:00:00.000Z', signature: 'invalid-test-signature',
  quoteRequest: request,
  quote: { amountIn: '150000000', amountInFormatted: '150', amountInUsd: '150', minAmountIn: '150000000',
    amountOut: '150000000', amountOutFormatted: '150', amountOutUsd: '150', minAmountOut: '149265000', timeEstimate: 10 },
};
describe('1Click signature coverage regression', () => {
  it('demonstrates why the confidentiality flag alone is not proof in SDK 0.1.26', () => {
    const changed = structuredClone(synthetic); changed.quoteRequest.confidentiality = QuoteRequest.confidentiality.PUBLIC;
    expect(quoteHash(changed)).toBe(quoteHash(synthetic));
  });
  it('confirms that recipientType, recipient and minimum output ARE signed', () => {
    const rail = structuredClone(synthetic); rail.quoteRequest.recipientType = QuoteRequest.recipientType.DESTINATION_CHAIN;
    const recipient = structuredClone(synthetic); recipient.quoteRequest.recipient = 'attacker.near';
    const floor = structuredClone(synthetic); floor.quote.minAmountOut = '1';
    for (const changed of [rail, recipient, floor]) expect(quoteHash(changed)).not.toBe(quoteHash(synthetic));
  });
  it('never accepts unsigned or malformed provider responses', () => {
    expect(verifyQuoteSignature(synthetic)).toBe(false);
    expect(() => validateQuote(synthetic, request, 50)).toThrow('QUOTE_SIGNATURE');
  });
});
