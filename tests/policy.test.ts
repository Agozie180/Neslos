import { describe, expect, it } from 'vitest';
import { minimumOutput, parseUsdc, U128_MAX, units } from '../src/core/amounts.js';
import { PolicyLedger } from '../src/core/ledger.js';
import { DEFAULT_POLICY, policySchema } from '../src/core/policy.js';
import type { Proposal } from '../src/core/types.js';

const NOW = Date.parse('2026-11-01T23:59:59.000Z');
export function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return { id: 'p1', policyId: DEFAULT_POLICY.id, policyVersion: 1, nonce: '0', kind: 'private-payment', amount: '150000000', asset: 'USDC', venue: 'near-intents', counterparty: 'research-agent', privacy: 'confidential', slippageBps: 25, quotedOutput: '150000000', minimumOutput: '149625000', quotedAt: NOW, expiresAt: NOW + 60_000, purpose: 'Pay for research', mode: 'rehearsal', ...overrides };
}
const ledger = () => new PolicyLedger(DEFAULT_POLICY, '10000000000', () => NOW);

describe('exact economic amounts', () => {
  it('parses six decimals without floating point', () => {
    expect(parseUsdc('9007199254.740993')).toBe('9007199254740993');
    expect(parseUsdc('0.000001')).toBe('1');
    expect(units(U128_MAX.toString())).toBe(U128_MAX);
  });
  it.each(['-1', '1e6', '01', ' 1', '1.0000001', 'NaN', 'Infinity'])('rejects noncanonical money %s', value => expect(() => parseUsdc(value)).toThrow());
  it('rejects u128 overflow', () => expect(() => units((U128_MAX + 1n).toString())).toThrow());
  it('rounds up the minimum to preserve a hard slippage ceiling', () => {
    expect(minimumOutput('1', 50)).toBe('1');
    expect(minimumOutput('100000001', 50)).toBe('99500001');
  });
});

describe('atomic guardian', () => {
  it('reserves first and uses a monotonic nonce', () => {
    const l = ledger();
    expect(l.reserve(proposal()).decision.allowed).toBe(true);
    expect(l.snapshot()).toMatchObject({ spent: '150000000', reserved: '150000000', remaining: '350000000', nextNonce: '1' });
  });
  it('idempotency never spends twice and changed payloads are rejected', () => {
    const l = ledger(); l.reserve(proposal());
    expect(l.reserve(proposal()).duplicate).toBe(true);
    expect(() => l.reserve(proposal({ amount: '160000000' }))).toThrow('IDEMPOTENCY_CONFLICT');
    expect(l.snapshot().spent).toBe('150000000');
  });
  it('parallel proposals cannot reuse a nonce or exceed a shared daily allowance', async () => {
    const l = ledger();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => Promise.resolve().then(() => l.reserve(proposal({ id: `parallel-${i}` })).decision.allowed)));
    expect(results.filter(Boolean)).toHaveLength(1);
    for (let i = 1; i < 7; i++) l.reserve(proposal({ id: `next-${i}`, nonce: l.snapshot().nextNonce }));
    expect(l.snapshot().spent).toBe('450000000');
  });
  it('policy edits preserve allowance usage and nonce, including lower caps', () => {
    const l = ledger(); l.reserve(proposal());
    l.update({ ...DEFAULT_POLICY, dailyLimit: '100000000', perTransactionLimit: '100000000' }, 1);
    expect(l.snapshot()).toMatchObject({ spent: '150000000', remaining: '0', nextNonce: '1' });
    expect(l.policy.version).toBe(2);
    expect(() => l.update(DEFAULT_POLICY, 1)).toThrow('POLICY_CONFLICT');
  });
  it.each([
    ['PER_ACTION', { amount: '201000000' }],
    ['DAILY_LIMIT', { amount: '501000000' }],
    ['COUNTERPARTY', { counterparty: 'attacker' }],
    ['VENUE', { venue: 'arbitrary-contract' }],
    ['VENUE', { strategyVenue: 'arbitrary-contract' }],
    ['NONCE', { nonce: '1' }],
    ['POLICY_VERSION', { policyVersion: 999 }],
    ['PRIVACY', { privacy: 'public' }],
    ['PRIVACY', { kind: 'public-lending' }],
    ['SLIPPAGE', { slippageBps: 51 }],
    ['SLIPPAGE', { minimumOutput: '1' }],
    ['SLIPPAGE', { minimumOutput: '150000001' }],
    ['QUOTE_FRESHNESS', { quotedAt: NOW + 1 }],
    ['QUOTE_FRESHNESS', { quotedAt: NOW - 61_000 }],
    ['QUOTE_FRESHNESS', { expiresAt: NOW }],
    ['QUOTE_FRESHNESS', { expiresAt: NOW + 301_000 }],
    ['AMOUNT', { amount: '-1' }],
  ] as [string, Partial<Proposal>][])('blocks %s without spending', (code, overrides) => {
    const l = ledger(); const result = l.reserve(proposal(overrides));
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.checks.find(c => c.code === code)?.passed).toBe(false);
    expect(l.snapshot().spent).toBe('0');
  });
  it('pause blocks a fresh authorization', () => {
    const l = ledger(); l.update({ ...DEFAULT_POLICY, paused: true }, 1);
    expect(l.reserve(proposal({ policyVersion: 2 })).decision.checks.find(c => c.code === 'PAUSED')?.passed).toBe(false);
  });
  it('a dispatch failure after midnight only restores its original day', () => {
    let now = NOW; const l = new PolicyLedger(DEFAULT_POLICY, '1000000000', () => now);
    l.reserve(proposal()); now += 2_000;
    l.reserve(proposal({ id: 'new-day', nonce: '1', quotedAt: now, expiresAt: now + 60_000 }));
    l.failDispatch('p1');
    expect(l.snapshot()).toMatchObject({ spent: '150000000', remaining: '350000000', balance: '850000000', nextNonce: '2' });
  });
  it('unknown settlement stays charged and cannot be refunded on a timeout', () => {
    const l = ledger(); l.reserve(proposal()); l.markDispatched('p1'); l.markUnknown('p1');
    expect(() => l.failDispatch('p1')).toThrow('UNSAFE_REFUND');
    expect(l.snapshot().spent).toBe('150000000');
    l.settle('p1'); expect(l.snapshot().spent).toBe('150000000');
  });
  it('rejects impossible or duplicate policy entries', () => {
    expect(() => policySchema.parse({ ...DEFAULT_POLICY, perTransactionLimit: '500000001' })).toThrow();
    expect(() => policySchema.parse({ ...DEFAULT_POLICY, allowedVenues: ['near-intents', 'near-intents'] })).toThrow();
  });
});
