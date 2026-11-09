import { describe, expect, it, vi } from 'vitest';
import { QuoteRequest, quoteHash, verifyQuoteSignature, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { canonical, sha256 } from '../src/core/crypto.js';
import { U128_MAX } from '../src/core/amounts.js';
import { quotePublicKey, signFixture } from './fixtures/quote.js';

vi.mock('@defuse-protocol/one-click-sdk-typescript', async original => {
  const sdk = await original<typeof import('@defuse-protocol/one-click-sdk-typescript')>();
  // Only replace the trusted public key in this test module. Hashing and Ed25519
  // verification remain the installed SDK's implementation, including its omissions.
  return { ...sdk, verifyQuoteSignature: (response: QuoteResponse) => sdk.verifyQuoteSignature(response, quotePublicKey) };
});

import { makeConfidentialQuoteRequest, validateConfidentialQuote, type ConfidentialQuoteContext } from '../src/owner/confidential-quote.js';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const THREE_DAYS = 259_200_000;
const AMOUNT = '1000000000000000000000';
const at = (offset: number) => new Date(NOW + offset).toISOString();
const modes = [true, false] as const;
const directions = ['shield', 'unshield'] as const;

function formatted(value: string): string {
  const amount = BigInt(value), scale = 10n ** 24n;
  const fraction = (amount % scale).toString().padStart(24, '0').replace(/0+$/, '');
  return (amount / scale).toString() + (fraction ? '.' + fraction : '');
}

function fixture(overrides: Partial<ConfidentialQuoteContext> = {}) {
  const input: ConfidentialQuoteContext = {
    direction: 'shield', ownerAccount: 'owner.near', confidentialId: 'ab'.repeat(32),
    amount: AMOUNT, dry: true, maxLossBps: 0, ...overrides,
  };
  const request = makeConfidentialQuoteRequest(input, NOW);
  const response = signFixture({
    correlationId: 'confidential-synthetic-test-only', timestamp: at(0), signature: '', quoteRequest: structuredClone(request),
    quote: {
      amountIn: input.amount, minAmountIn: input.amount, amountOut: input.amount, minAmountOut: input.amount,
      amountInFormatted: formatted(input.amount), amountOutFormatted: formatted(input.amount), amountInUsd: '0.004', amountOutUsd: '0.004',
      timeEstimate: 5, refundFee: '0', withdrawFee: '0',
      ...(!input.dry ? {
        depositAddress: input.direction === 'shield' ? 'deposit.near' : 'cd'.repeat(32),
        deadline: at(180_000 + THREE_DAYS), timeWhenInactive: at(180_000 + THREE_DAYS),
      } : {}),
    },
  });
  return { input, request, response };
}

function setOutput(response: QuoteResponse, amount: string): void {
  Object.assign(response.quote, { amountOut: amount, minAmountOut: amount, amountOutFormatted: formatted(amount) });
}

describe('owner-only same-asset quote requests', () => {
  it.each(directions.flatMap(direction => modes.map(dry => ({ direction, dry }))))('binds $direction dry=$dry to the exact owner, asset, amount and rail', ({ direction, dry }) => {
    const { input, request, response } = fixture({ direction, dry });
    const shield = direction === 'shield';
    expect(request).toEqual({
      dry, swapType: 'EXACT_INPUT', slippageTolerance: 0, originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:wrap.near', amount: AMOUNT,
      depositType: shield ? 'ORIGIN_CHAIN' : 'CONFIDENTIAL_INTENTS', recipientType: shield ? 'CONFIDENTIAL_INTENTS' : 'DESTINATION_CHAIN',
      recipient: shield ? input.confidentialId : input.ownerAccount, refundType: shield ? 'ORIGIN_CHAIN' : 'CONFIDENTIAL_INTENTS',
      refundTo: shield ? input.ownerAccount : input.confidentialId, confidentiality: 'advanced', deadline: at(180_000),
      depositMode: 'SIMPLE', quoteWaitingTimeMs: 0, appFees: [], insured: false,
    });
    const validated = validateConfidentialQuote(response, request, input, NOW);
    expect(validated).toMatchObject({ format: 'neslos-confidential-owner-proof-quote-v1', direction, dry, signatureVerified: true, amountIn: AMOUNT, amountOut: AMOUNT, principalLoss: '0' });
    expect(validated.hash).toBe(sha256(canonical(response)));
    expect(validated.execution).toEqual(dry ? null : { depositAddress: response.quote.depositAddress, deadline: request.deadline, depositAddressExpiresAt: response.quote.deadline });
    expect(validated.fees).toEqual({ evidence: dry ? 'https-estimate' : 'provider-signed', refundFee: '0', withdrawFee: '0' });
  });

  it('keeps the synthetic provider key confined to tests', async () => {
    const sdk = await vi.importActual<typeof import('@defuse-protocol/one-click-sdk-typescript')>('@defuse-protocol/one-click-sdk-typescript');
    const { response } = fixture();
    expect(sdk.verifyQuoteSignature(response, quotePublicKey)).toBe(true);
    expect(sdk.verifyQuoteSignature(response)).toBe(false);
  });

  it.each(modes)('accepts omitted harmless defaults without changing the retained signed response (dry=%s)', dry => {
    const { input, request, response } = fixture({ dry });
    const originalHash = quoteHash(response);
    for (const field of ['depositMode', 'quoteWaitingTimeMs', 'appFees', 'insured'] as const) { delete request[field]; delete response.quoteRequest[field]; }
    const before = structuredClone(response);
    expect(quoteHash(response)).toBe(originalHash);
    const validated = validateConfidentialQuote(response, request, input, NOW);
    expect(validated.request).toMatchObject({ depositMode: 'SIMPLE', quoteWaitingTimeMs: 0, appFees: [], insured: false });
    expect(validated.response).toEqual(before);
    response.quote.amountOut = '1'; request.recipient = 'attacker.near';
    expect(validated.response).toEqual(before);
    expect(validated.request.recipient).toBe(input.confidentialId);
    expect(validated.hash).toBe(sha256(canonical(before)));
  });

  it.each(directions.flatMap(direction => modes.map(dry => ({ direction, dry }))))('rejects a substituted local request even when its echo and signature agree ($direction dry=$dry)', ({ direction, dry }) => {
    const { input } = fixture({ direction, dry });
    for (const change of [
      { ownerAccount: 'attacker.near' }, { confidentialId: 'ef'.repeat(32) }, { amount: '1000000000000000000001' },
      { direction: direction === 'shield' ? 'unshield' as const : 'shield' as const }, { dry: !dry },
    ]) {
      const substituted = fixture({ ...input, ...change });
      expect(() => validateConfidentialQuote(substituted.response, substituted.request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_CONTEXT_BINDING$/);
    }
  });
});

describe('installed SDK 0.1.26 signature coverage', () => {
  const unsignedOptions: [string, unknown][] = [
    ['confidentiality', QuoteRequest.confidentiality.PUBLIC], ['depositMode', QuoteRequest.depositMode.MEMO],
    ['appFees', [{ recipient: 'attacker.near', fee: 1 }]], ['insured', true], ['rebates', [{ recipient: 'attacker.near', share: 100 }]],
    ['connectedWallets', ['attacker.near']], ['sessionId', 'injected-session'], ['partnerId', 'injected-partner'],
    ['userAccountId', 'attacker.near'], ['correlationId', 'injected-correlation'],
  ];
  it.each(unsignedOptions.flatMap(([field, value]) => modes.map(dry => ({ field, value, dry }))))('rejects unsigned request $field despite a valid signature (dry=$dry)', ({ field, value, dry }) => {
    const { input, request, response } = fixture({ dry }), before = quoteHash(response);
    Object.assign(response.quoteRequest, { [field]: value });
    expect(quoteHash(response)).toBe(before);
    expect(verifyQuoteSignature(response)).toBe(true);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
  });

  const signedRequestFields: [string, unknown][] = [
    ['dry', false], ['swapType', 'EXACT_OUTPUT'], ['slippageTolerance', 1], ['originAsset', 'nep141:other.near'],
    ['destinationAsset', 'nep141:other.near'], ['amount', '2'], ['depositType', 'CONFIDENTIAL_INTENTS'],
    ['refundTo', 'attacker.near'], ['refundType', 'CONFIDENTIAL_INTENTS'], ['recipient', 'attacker.near'],
    ['recipientType', 'DESTINATION_CHAIN'], ['deadline', at(170_000)], ['quoteWaitingTimeMs', 1], ['referral', 'injected'],
    ['virtualChainRecipient', '0x1234'], ['virtualChainRefundRecipient', '0x1234'], ['customRecipientMsg', 'injected'],
  ];
  it.each(signedRequestFields)('verifies the dry signature binds request %s', (field, value) => {
    const { response } = fixture(), before = quoteHash(response);
    Object.assign(response.quoteRequest, { [field]: value });
    expect(quoteHash(response)).not.toBe(before);
    expect(verifyQuoteSignature(response)).toBe(false);
  });

  it.each(modes)('rejects validly signed changes to the owner or confidential rails (dry=%s)', dry => {
    for (const change of [
      { recipient: 'attacker.near' }, { refundTo: 'attacker.near' }, { recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN },
      { depositType: QuoteRequest.depositType.CONFIDENTIAL_INTENTS }, { refundType: QuoteRequest.refundType.CONFIDENTIAL_INTENTS },
      { amount: '2' }, { dry: !dry }, { deadline: at(170_000) },
    ]) {
      const { input, request, response } = fixture({ dry });
      Object.assign(response.quoteRequest, change);
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_BINDING$/);
    }
  });

  it('detects the live deadline hash collision and binds the unsigned echo to the trusted local request', () => {
    const { input, request, response } = fixture({ dry: false }), original = quoteHash(response);
    response.quoteRequest.deadline = at(170_000);
    expect(quoteHash(response)).toBe(original);
    expect(verifyQuoteSignature(response)).toBe(true);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_BINDING$/);
    response.quoteRequest.deadline = request.deadline;
    response.quote.deadline = at(170_000 + THREE_DAYS);
    expect(quoteHash(response)).not.toBe(original);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_SIGNATURE$/);
  });

  it.each(modes)('binds every amount, its display and the provider timestamp (dry=%s)', dry => {
    for (const field of ['amountIn', 'minAmountIn', 'amountOut', 'minAmountOut', 'amountInFormatted', 'amountOutFormatted', 'amountInUsd', 'amountOutUsd'] as const) {
      const { input, request, response } = fixture({ dry }), before = quoteHash(response);
      response.quote[field] = '2';
      expect(quoteHash(response)).not.toBe(before);
      expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_SIGNATURE$/);
    }
    const { input, request, response } = fixture({ dry }); response.timestamp = at(1);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_SIGNATURE$/);
  });

  it('preserves unsigned trace and dry fee/estimate changes only as locally hashed estimates', () => {
    const { input, request, response } = fixture({ amount: '10000', maxLossBps: 100 }), original = quoteHash(response);
    const originalProof = validateConfidentialQuote(response, request, input, NOW);
    response.correlationId = 'different-trace';
    Object.assign(response.quote, { refundFee: '50', withdrawFee: '100', timeEstimate: 20 });
    expect(quoteHash(response)).toBe(original);
    expect(verifyQuoteSignature(response)).toBe(true);
    const changed = validateConfidentialQuote(response, request, input, NOW);
    expect(changed.fees).toEqual({ evidence: 'https-estimate', refundFee: '50', withdrawFee: '100' });
    expect(changed.hash).not.toBe(originalProof.hash);
    expect(changed.execution).toBeNull();
  });

  it.each(['refundFee', 'withdrawFee', 'timeEstimate', 'depositAddress', 'timeWhenInactive'] as const)('binds live %s, including explicit zero fees', field => {
    const { input, request, response } = fixture({ dry: false }), before = quoteHash(response);
    Object.assign(response.quote, { [field]: field === 'timeEstimate' ? 6 : field === 'depositAddress' ? 'other.near' : field === 'timeWhenInactive' ? at(100_000) : '1' });
    expect(quoteHash(response)).not.toBe(before);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_SIGNATURE$/);
  });

  it.each(modes)('rejects unsigned alternate routing, unknown fields and deposit memos (dry=%s)', dry => {
    for (const change of [
      { customRecipientMsg: '' }, { customRecipientMsg: 'injected' }, { virtualChainRecipient: '0x1234' },
      { virtualChainRefundRecipient: '0x5678' }, { chainDepositAddresses: [] }, { recipient: 'attacker.near' },
    ]) {
      const { input, request, response } = fixture({ dry }), before = quoteHash(response);
      Object.assign(response.quote, change);
      expect(quoteHash(response)).toBe(before);
      expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    }
    for (const memo of ['', 'memo']) {
      const { input, request, response } = fixture({ dry }); response.quote.depositMemo = memo;
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    }
  });
});

describe('exact amount and fee limits', () => {
  it.each(modes)('requires exact input, exact zero-slippage output and accurate 24-decimal displays (dry=%s)', dry => {
    const changes: [Partial<QuoteResponse['quote']>, string][] = [
      [{ amountIn: '999999999999999999999' }, 'AMOUNT'], [{ minAmountIn: '999999999999999999999' }, 'AMOUNT'],
      [{ amountOut: '1000000000000000000001' }, 'AMOUNT'], [{ minAmountOut: '999999999999999999999' }, 'SLIPPAGE'],
      [{ amountInFormatted: '0.001000000000000000000001' }, 'DISPLAY'], [{ amountOutFormatted: '0.001000000000000000000001' }, 'DISPLAY'],
    ];
    for (const [change, error] of changes) {
      const { input, request, response } = fixture({ dry }); Object.assign(response.quote, change);
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(new RegExp('^CONFIDENTIAL_QUOTE_' + error + '$'));
    }
  });

  it.each(modes)('caps net output and each alternative fee without double-counting withdrawal (dry=%s)', dry => {
    const { input, request, response } = fixture({ dry, amount: '10000', maxLossBps: 100 });
    setOutput(response, '9900'); response.quote.refundFee = '100'; response.quote.withdrawFee = '100';
    expect(validateConfidentialQuote(signFixture(response), request, input, NOW).principalLoss).toBe('100');
    for (const field of ['refundFee', 'withdrawFee'] as const) {
      const excessive = structuredClone(response); excessive.quote[field] = '101';
      expect(() => validateConfidentialQuote(signFixture(excessive), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_LOSS$/);
    }
    setOutput(response, '9899');
    expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_LOSS$/);
  });

  it.each(modes)('enforces zero loss and zero declared fees when maxLossBps is zero (dry=%s)', dry => {
    for (const field of ['refundFee', 'withdrawFee', 'amountOut'] as const) {
      const { input, request, response } = fixture({ dry });
      if (field === 'amountOut') setOutput(response, (BigInt(AMOUNT) - 1n).toString()); else response.quote[field] = '1';
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_LOSS$/);
    }
  });

  it('rounds a hard loss floor up at base-unit precision and supports the full u128 range', () => {
    const tiny = fixture({ amount: '1001', maxLossBps: 1 }); setOutput(tiny.response, '1000');
    expect(() => validateConfidentialQuote(signFixture(tiny.response), tiny.request, tiny.input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_LOSS$/);
    const boundary = fixture({ amount: '10001', maxLossBps: 1 }); setOutput(boundary.response, '10000'); boundary.response.quote.withdrawFee = '1';
    expect(validateConfidentialQuote(signFixture(boundary.response), boundary.request, boundary.input, NOW).principalLoss).toBe('1');
    const largest = fixture({ amount: U128_MAX.toString() });
    expect(validateConfidentialQuote(largest.response, largest.request, largest.input, NOW).amountIn).toBe(U128_MAX.toString());
    const smallest = fixture({ amount: '1' });
    expect(validateConfidentialQuote(smallest.response, smallest.request, smallest.input, NOW).response.quote.amountInFormatted).toBe('0.000000000000000000000001');
  });

  it('represents absent dry fees as unknown and rejects absent live fees even with a valid signature', () => {
    for (const dry of modes) for (const missing of [['refundFee'], ['withdrawFee'], ['refundFee', 'withdrawFee']] as const) {
      const { input, request, response } = fixture({ dry });
      for (const field of missing) delete response.quote[field];
      const signed = signFixture(response); expect(verifyQuoteSignature(signed)).toBe(true);
      if (dry) {
        const fees = validateConfidentialQuote(signed, request, input, NOW).fees;
        for (const field of missing) expect(fees[field]).toBeNull();
      } else expect(() => validateConfidentialQuote(signed, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_FEES$/);
    }
  });
});

describe('dry/live execution and time binding', () => {
  it.each(['depositAddress', 'deadline', 'timeWhenInactive'] as const)('never accepts dry %s even though the SDK ignores it', field => {
    const { input, request, response } = fixture(), before = quoteHash(response);
    response.quote[field] = field === 'depositAddress' ? 'attacker.near' : at(120_000);
    expect(quoteHash(response)).toBe(before); expect(verifyQuoteSignature(response)).toBe(true);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_DRY_EXECUTION$/);
  });

  it('uses the earlier local cutoff while preserving the signed address expiry separately', () => {
    const { input, request, response } = fixture({ dry: false });
    const retained = validateConfidentialQuote(response, request, input, NOW);
    expect(retained.execution).toEqual({ depositAddress: 'deposit.near', deadline: at(180_000), depositAddressExpiresAt: at(180_000 + THREE_DAYS) });
    expect(() => validateConfidentialQuote(response, request, input, NOW + 180_000)).toThrow(/^CONFIDENTIAL_QUOTE_DEADLINE$/);
    response.quote.deadline = at(120_000); response.quote.timeWhenInactive = at(120_000);
    expect(validateConfidentialQuote(signFixture(response), request, input, NOW).execution?.deadline).toBe(at(120_000));
  });

  it.each([0, -1, 180_001])('rejects expired or overlong trusted requests (%s ms)', deadline => {
    const { input, request, response } = fixture(); request.deadline = at(deadline); response.quoteRequest.deadline = request.deadline;
    expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_DEADLINE$/);
  });

  it.each([-60_001, 5_001])('rejects signed stale/future timestamps (%s ms)', offset => {
    const { input, request, response } = fixture(); response.timestamp = at(offset);
    expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_TIME$/);
  });

  it.each([-60_000, 5_000])('accepts the documented freshness boundary (%s ms)', offset => {
    const { input, request, response } = fixture(); response.timestamp = at(offset);
    expect(validateConfidentialQuote(signFixture(response), request, input, NOW).signatureVerified).toBe(true);
  });

  it('requires the signed timestamp to precede the trusted cutoff', () => {
    const { input, request, response } = fixture(); request.deadline = at(1); response.quoteRequest.deadline = request.deadline; response.timestamp = at(1);
    expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_TIME$/);
  });

  it('rejects absent, expired, excessive, or inconsistent live address metadata', () => {
    for (const change of [
      { deadline: at(0) }, { deadline: at(-1) }, { deadline: at(180_000 + THREE_DAYS + 1) },
      { timeWhenInactive: at(180_000 + THREE_DAYS + 1) },
    ]) {
      const { input, request, response } = fixture({ dry: false }); Object.assign(response.quote, change);
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_EXECUTION$/);
    }
    for (const field of ['deadline', 'depositAddress'] as const) {
      const { input, request, response } = fixture({ dry: false }); delete response.quote[field];
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_EXECUTION$/);
    }
  });
});

describe('canonical wire values and fail-closed response shapes', () => {
  const nonCanonicalAmounts = ['', '0', '01', '+1', '-1', '1.0', '1e3', '0x10', ' 1', '1 ', '1\n', '1\r', '1\u2028', '1\u2029', (U128_MAX + 1n).toString(), '9'.repeat(40)];
  it.each(nonCanonicalAmounts)('rejects noncanonical/invalid owner amount %j with a domain error', amount => {
    const { input, request, response } = fixture(); input.amount = amount;
    expect(() => makeConfidentialQuoteRequest(input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_CONTEXT$/);
    expect(() => validateConfidentialQuote(response, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_CONTEXT$/);
  });

  it('rejects malformed signed amounts and fees without leaking parser exceptions', () => {
    for (const amount of nonCanonicalAmounts) for (const field of ['amountIn', 'minAmountIn', 'amountOut', 'minAmountOut', 'refundFee', 'withdrawFee'] as const) {
      if (amount === '0' && (field === 'refundFee' || field === 'withdrawFee')) continue;
      const { input, request, response } = fixture(); response.quote[field] = amount;
      expect(() => validateConfidentialQuote(signFixture(response), request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    }
  });

  it('rejects malformed dates, displays, account identifiers, limits and clocks', () => {
    const { input, request, response } = fixture({ dry: false });
    for (const date of ['2026-11-06T12:00:00Z', '2026-11-06T12:00:00.0000Z', '2026-11-06T12:00:00.000+00:00', at(0) + '\n', '2026-13-06T12:00:00.000Z']) {
      expect(() => validateConfidentialQuote(response, { ...request, deadline: date }, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_REQUEST$/);
      expect(() => validateConfidentialQuote({ ...response, timestamp: date }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
      for (const field of ['deadline', 'timeWhenInactive'] as const) expect(() => validateConfidentialQuote({ ...response, quote: { ...response.quote, [field]: date } }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    }
    for (const display of ['0.001\n', '+0.001', '01.001', '1e-3', '0.0010000000000000000000000']) {
      expect(() => validateConfidentialQuote({ ...response, quote: { ...response.quote, amountOutFormatted: display } }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    }
    for (const change of [{ ownerAccount: 'owner.near\n' }, { ownerAccount: 'Owner.near' }, { confidentialId: 'ab'.repeat(32) + '\n' }, { confidentialId: 'AB'.repeat(32) }, { maxLossBps: -1 }, { maxLossBps: 1001 }, { maxLossBps: 0.5 }, { maxLossBps: NaN }]) {
      expect(() => makeConfidentialQuoteRequest({ ...input, ...change }, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_CONTEXT$/);
    }
    for (const now of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_000]) expect(() => makeConfidentialQuoteRequest(input, now)).toThrow(/^CONFIDENTIAL_QUOTE_TIME$/);
  });

  it.each(modes)('rejects null, explicit undefined and unknown data instead of erasing it (dry=%s)', dry => {
    const { input, request, response } = fixture({ dry });
    for (const malformed of [null, [], {}, { ...response, extra: true }, { ...response, signature: '' }, { ...response, quote: null }]) {
      expect(() => validateConfidentialQuote(malformed, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    }
    for (const value of [undefined, null]) {
      for (const field of ['refundFee', 'withdrawFee', 'depositAddress', 'deadline', 'timeWhenInactive'] as const) {
        expect(() => validateConfidentialQuote({ ...response, quote: { ...response.quote, [field]: value } }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
      }
      for (const field of ['depositMode', 'quoteWaitingTimeMs', 'appFees', 'insured'] as const) {
        expect(() => validateConfidentialQuote(response, { ...request, [field]: value }, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_REQUEST$/);
        expect(() => validateConfidentialQuote({ ...response, quoteRequest: { ...response.quoteRequest, [field]: value } }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
      }
    }
    for (const timeEstimate of [-1, NaN, Infinity, 86_401]) expect(() => validateConfidentialQuote({ ...response, quote: { ...response.quote, timeEstimate } }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_RESPONSE$/);
    expect(() => validateConfidentialQuote({ ...response, signature: 'invalid-signature' }, request, input, NOW)).toThrow(/^CONFIDENTIAL_QUOTE_SIGNATURE$/);
  });
});
