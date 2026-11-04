import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { quoteFixture, quotePublicKey, signFixture } from './fixtures/quote.js';
const mocks = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('../src/core/research.js', async original => ({ ...await original<typeof import('../src/core/research.js')>(), fetchJson: mocks.fetchJson }));
vi.mock('@defuse-protocol/one-click-sdk-typescript', async original => {
  const sdk = await original<typeof import('@defuse-protocol/one-click-sdk-typescript')>();
  // Real SDK Ed25519 verification with a fixture key, confined to this test module.
  return { ...sdk, verifyQuoteSignature: (response: QuoteResponse) => sdk.verifyQuoteSignature(response, quotePublicKey) };
});
import { IntentsClient, validateQuote } from '../src/core/intents.js';
import { NATIVE_USDC } from '../src/core/research.js';

beforeEach(() => vi.resetAllMocks());
describe('signed quote validation with the official SDK and a test signer', () => {
  it.each([true, false])('accepts a valid signed quote (dry=%s)', dry => {
    const response = quoteFixture(dry);
    expect(validateQuote(response, response.quoteRequest, 50).signatureVerified).toBe(true);
  });
  it('rejects a tampered amount before any route validation', () => {
    const response = quoteFixture(); response.quote.amountOut = '1';
    expect(() => validateQuote(response, response.quoteRequest, 50)).toThrow('QUOTE_SIGNATURE');
  });
  it.each([
    ['recipient', (q: QuoteResponse) => { q.quoteRequest.recipient = 'other.near'; }, 'QUOTE_BINDING'],
    ['minimum', (q: QuoteResponse) => { q.quote.minAmountOut = '1'; }, 'QUOTE_FLOOR'],
    ['input', (q: QuoteResponse) => { q.quote.amountIn = '150000001'; }, 'QUOTE_AMOUNT'],
    ['staleness', (q: QuoteResponse) => { q.timestamp = new Date(Date.now() - 70_000).toISOString(); }, 'STALE_QUOTE'],
    ['memo', (q: QuoteResponse) => { q.quote.depositMemo = 'unsupported'; }, 'UNSUPPORTED_MEMO'],
    ['expiry', (q: QuoteResponse) => { q.quote.deadline = new Date(Date.now() - 1).toISOString(); }, 'QUOTE_DEADLINE'],
  ] as const)('rejects signed but invalid %s', (_name, change, error) => {
    const response = quoteFixture(), request = structuredClone(response.quoteRequest); change(response);
    expect(() => validateQuote(signFixture(response), request, 50)).toThrow(error);
  });
  it('discovers the exact native NEAR input and requests confidential output', async () => {
    const response = quoteFixture();
    mocks.fetchJson.mockResolvedValueOnce([
      { assetId: 'nep141:btc.omft.near', blockchain: 'btc', symbol: 'BTC', decimals: 8, contractAddress: null },
      { assetId: 'nep141:' + NATIVE_USDC, blockchain: 'near', symbol: 'USDC', decimals: 6 },
      { assetId: 'nep141:usdt.tether-token.near', blockchain: 'near', symbol: 'USDT', decimals: 6 },
    ]).mockImplementationOnce(async (_url, options) => signFixture({ ...response, quoteRequest: JSON.parse(options.body) }));
    const result = await new IntentsClient('fixture-token').quote({ amount: '150000000', maxSlippageBps: 50, recipient: 'recipient.near', refundTo: 'vault.near', dry: false });
    expect(result.response.quoteRequest).toMatchObject({ depositType: 'ORIGIN_CHAIN', recipientType: 'CONFIDENTIAL_INTENTS', confidentiality: 'advanced' });
    expect(result.response.quote.depositAddress).toBe('deposit.near');
  });
});
describe('provider settlement observations', () => {
  it.each([
    ['PENDING_DEPOSIT', 'pending'], ['KNOWN_DEPOSIT_TX', 'pending'], ['PROCESSING', 'pending'], ['INCOMPLETE_DEPOSIT', 'pending'],
    ['SUCCESS', 'success'], ['REFUNDED', 'refunded'], ['FAILED', 'failed'], ['NEW_PROVIDER_STATUS', 'unknown'], ['__proto__', 'unknown'],
  ])('%s becomes %s', async (status, expected) => {
    const response = quoteFixture();
    mocks.fetchJson.mockResolvedValue({ status, quoteResponse: response });
    expect((await new IntentsClient().status(validateQuote(response, response.quoteRequest, 50))).outcome).toBe(expected);
  });
  it.each(['mismatched', 'unsigned', 'transport', 'malformed'])('keeps %s evidence unknown', async failure => {
    const response = quoteFixture(), expected = validateQuote(response, response.quoteRequest, 50);
    const other = structuredClone(response);
    if (failure === 'mismatched') { other.quote.depositAddress = 'other.near'; Object.assign(other, signFixture(other)); }
    if (failure === 'unsigned') other.signature = 'invalid';
    if (failure === 'transport') mocks.fetchJson.mockRejectedValue(new Error('timeout'));
    else mocks.fetchJson.mockResolvedValue(failure === 'malformed' ? {} : { status: 'SUCCESS', quoteResponse: other });
    expect((await new IntentsClient().status(expected)).outcome).toBe('unknown');
  });
});
