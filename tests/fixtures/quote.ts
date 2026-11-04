import { sign } from 'node:crypto';
import { QuoteRequest, quoteHash, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { baseEncode } from 'near-api-js';
import { keyFromSeed } from '../../src/core/crypto.js';
import { NATIVE_USDC } from '../../src/core/research.js';

// Public, deterministic TEST identity. Never accepted by the production 1Click verifier.
export const quoteSigner = keyFromSeed(new Uint8Array(32).fill(19));
export const quotePublicKey = 'ed25519:' + baseEncode(Buffer.from(quoteSigner.publicKey, 'hex'));
export function signFixture(response: QuoteResponse): QuoteResponse {
  return { ...response, signature: 'ed25519:' + baseEncode(sign(null, Buffer.from(quoteHash(response)), quoteSigner.privateKey)) };
}
export function quoteFixture(dry = false, now = Date.now()): QuoteResponse {
  return signFixture({
    correlationId: 'synthetic-test-only', timestamp: new Date(now).toISOString(), signature: '',
    quoteRequest: {
      dry, swapType: QuoteRequest.swapType.EXACT_INPUT, slippageTolerance: 49,
      originAsset: 'nep141:' + NATIVE_USDC, destinationAsset: 'nep141:usdt.tether-token.near',
      amount: '150000000', depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      refundTo: 'vault.near', refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: 'recipient.near', recipientType: QuoteRequest.recipientType.CONFIDENTIAL_INTENTS,
      confidentiality: QuoteRequest.confidentiality.ADVANCED, deadline: new Date(now + 180_000).toISOString(),
    },
    quote: {
      amountIn: '150000000', amountInFormatted: '150', amountInUsd: '150', minAmountIn: '150000000',
      amountOut: '150000000', amountOutFormatted: '150', amountOutUsd: '150', minAmountOut: '149265000', timeEstimate: 10,
      ...(!dry ? { depositAddress: 'deposit.near', deadline: new Date(now + 120_000).toISOString() } : {}),
    },
  });
}
