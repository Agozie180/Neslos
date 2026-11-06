import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMarketClient, agentQuoteHash, type AgentQuote } from '../src/core/agent-market.js';
import { commitment } from '../src/core/crypto.js';
import { readLendingPosition, RHEA_CONTRACTS, type LendingSnapshot } from '../src/core/lending.js';
import { readVault, viewNear } from '../src/core/near.js';
import { NATIVE_USDC } from '../src/core/research.js';
import { assertCommerceState, commerceRequestBytes, commerceRequestHash, type CommerceRequest, type CommerceVaultState } from '../src/core/vault-commerce.js';
import { submitOnce } from '../src/owner/account.js';
import { CommerceBudget, type CommercePolicy, type VaultCommercePolicy } from '../src/owner/commerce-budget.js';
import { commerceCall, commercePlanHash, executeCommercePlan, payAgentJob, planCommerceStorage, planLending, planVaultPayment } from '../src/owner/commerce.js';

vi.mock('../src/core/near.js', async original => ({ ...await original<typeof import('../src/core/near.js')>(), readVault: vi.fn(), viewNear: vi.fn() }));
vi.mock('../src/core/lending.js', async original => ({ ...await original<typeof import('../src/core/lending.js')>(), readLendingPosition: vi.fn() }));
vi.mock('../src/owner/account.js', async original => ({ ...await original<typeof import('../src/owner/account.js')>(), submitOnce: vi.fn() }));
const salt = '1'.repeat(64), target = 'merchant.testnet', protocol = RHEA_CONTRACTS.testnet;
const policy: VaultCommercePolicy = { format: 'neslos-commerce-policy-v2', account: 'owner.testnet', vault: 'vault.testnet', network: 'testnet', totalNativeLimitYocto: '10000000000000000000000000', allowPublicLending: true, allowedAgentHandles: ['web-research'], openings: [{ venue: 'merchant', target, venueSalt: salt, counterpartySalt: salt }, { venue: 'rhea', target: protocol, venueSalt: salt, counterpartySalt: salt }] };
const chain = (): CommerceVaultState => ({
  config: { owner_id: policy.account, token_id: 'token.testnet', network: 'testnet', executor_public_key: 'a'.repeat(64), policy_version: '3',
    policy: { daily_limit: '1000', per_action_limit: '100', max_slippage_bps: 0, max_quote_age_ms: '60000', venue_commitments: policy.openings.map(o => commitment('venue', o.venue, salt)), counterparty_commitments: policy.openings.map(o => commitment('counterparty', o.target, salt)), output_assets: ['nep141:token.testnet'], require_confidential: false, paused: false } },
  budget: { day: '20000', used: '40', remaining: '960', policy_version: '3', next_nonce: '7', paused: false }, balance: '10000', blockHash: 'fixture-finalized-block', blockHeight: 100,
});
const position = (): LendingSnapshot => ({ format: 'neslos-rhea-snapshot-v1', network: 'testnet', contract: protocol, account: policy.vault, token: 'token.testnet', asset: { token_id: 'token.testnet', supplied: { shares: '1000000', balance: '1000000' }, borrowed: { shares: '0', balance: '0' }, config: { extra_decimals: 2, can_deposit: true, can_withdraw: true }, last_update_timestamp: '1' }, position: { account_id: policy.vault, supplied: [{ token_id: 'token.testnet', shares: '10000', balance: '10000' }], borrowed: [] }, walletBalance: '10000', tokenDecimals: 6, blockHash: 'fixture-finalized-block', blockHeight: 100, fetchedAt: new Date().toISOString() });
const budget = async (p: CommercePolicy = policy) => new CommerceBudget(await mkdtemp(join(tmpdir(), 'neslos-vault-commerce-')), p);
const owner = () => ({ network: 'testnet', account: { accountId: policy.account, createSignedMetaTransaction: vi.fn() }, provider: { viewBlock: vi.fn(async () => ({ header: { gas_price: '100000000' } })) } }) as never;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readVault).mockResolvedValue(chain()); vi.mocked(readLendingPosition).mockResolvedValue(position());
  vi.mocked(viewNear).mockResolvedValue({ value: { total: '100', available: '0' }, blockHash: 'fixture-finalized-block', blockHeight: 100 });
  vi.mocked(submitOnce).mockResolvedValue({ hash: 'fixture-hash', outcome: { final_execution_status: 'FINAL', status: { SuccessValue: 'dHJ1ZQ==' } } } as never);
});

describe('vault commerce custody and caps', () => {
  it('matches the Rust CommerceRequestV1 Borsh interoperability vector', () => {
    const request: CommerceRequest = { domain: 'neslos:commerce:v1', network: 'testnet', vault: 'vault.testnet', policy_version: '1', nonce: '0', action: 0, amount: '100', target: 'payee.testnet', venue: 'public-payment', venue_salt: 'a'.repeat(64), counterparty_salt: 'b'.repeat(64), quoted_at_ms: '1793577599000', expires_at_ms: '1793577659000', quote_hash: 'c'.repeat(64), audit_hash: 'd'.repeat(64) };
    expect(commerceRequestBytes(request).length).toBe(406);
    expect(commerceRequestHash(request)).toBe('8ca76695b9c58d538a014e4d26beea3faed82993954cedcb22f911d9b7e23c4f');
    expect(commerceRequestHash({ ...request, nonce: '1' })).not.toBe(commerceRequestHash(request));
  });
  it('routes payment to the vault and uses the chain nonce/version and cap', async () => {
    const plan = await planVaultPayment(await budget(), '100', target, 'merchant'), call = commerceCall(plan);
    expect(call).toMatchObject({ receiverId: policy.vault, methodName: 'execute_commerce_v1', deposit: '10000000000000000000000', args: { request: { action: 0, amount: '100', nonce: '7', policy_version: '3', target } } });
    await expect(planVaultPayment(await budget(), '101', target, 'merchant')).rejects.toThrow('COMMERCE_CHAIN_BUDGET_EXHAUSTED');
  });
  it('reads and supplies the vault position; withdrawal fixes protocol precision without signing a direct Rhea call', async () => {
    for (const op of ['supply', 'withdraw'] as const) {
      const plan = await planLending(await budget(), op, '50');
      expect(readLendingPosition).toHaveBeenCalledWith(policy.vault, 'token.testnet', 'testnet');
      expect(commerceCall(plan)).toMatchObject({ receiverId: policy.vault, methodName: 'execute_commerce_v1', args: { request: { action: op === 'supply' ? 1 : 2, amount: '50', target: protocol, venue: 'rhea' } } });
    }
  });
  it('rejects public actions under a confidential policy before reading positions or signing', async () => {
    const state = chain(); state.config.policy.require_confidential = true; vi.mocked(readVault).mockResolvedValue(state);
    await expect(planLending(await budget(), 'supply', '1')).rejects.toThrow('COMMERCE_PRIVATE_POLICY');
    await expect(planVaultPayment(await budget(), '1', target, 'merchant')).rejects.toThrow('COMMERCE_PRIVATE_POLICY');
    expect(readLendingPosition).not.toHaveBeenCalled(); expect(submitOnce).not.toHaveBeenCalled();
  });
  it('checks pause, exact openings, output token, current nonce/version, freshness and remaining chain allowance', async () => {
    const plan = await planVaultPayment(await budget(), '100', target, 'merchant');
    if (plan.operation.kind !== 'payment') throw new Error('fixture');
    const request = plan.operation.request;
    const mutations: [string, (s: CommerceVaultState) => void][] = [
      ['COMMERCE_VAULT_PAUSED', s => { s.config.policy.paused = true; }],
      ['COMMERCE_ALLOWLIST_BINDING', s => { s.config.policy.venue_commitments = []; }],
      ['COMMERCE_OUTPUT_ASSET', s => { s.config.policy.output_assets = []; }],
      ['COMMERCE_STATE_CHANGED', s => { s.budget.next_nonce = '8'; }],
      ['COMMERCE_STATE_CHANGED', s => { s.config.policy_version = '4'; }],
      ['COMMERCE_CHAIN_BUDGET_EXHAUSTED', s => { s.budget.remaining = '99'; }],
      ['COMMERCE_VAULT_BALANCE', s => { s.balance = '99'; }],
    ];
    for (const [error, mutate] of mutations) { const state = chain(); mutate(state); expect(() => assertCommerceState(request, state, policy.account, 'token.testnet')).toThrow(error); }
    expect(() => assertCommerceState(request, chain(), policy.account, 'token.testnet', Number(request.expires_at_ms))).toThrow('COMMERCE_PLAN_STALE');
  });
  it('rejects substituted vault/position and legacy plans', async () => {
    const plan = await planLending(await budget(), 'supply', '50');
    expect(() => commerceCall({ ...plan, vault: 'other.testnet' })).toThrow('COMMERCE_PLAN_BINDING');
    if (plan.operation.kind !== 'lending') throw new Error('fixture');
    plan.operation.plan.snapshot.account = 'owner.testnet';
    expect(() => commerceCall(plan)).toThrow('COMMERCE_LENDING_BINDING');
    expect(() => commerceCall({ format: 'neslos-commerce-plan-v1', id: randomUUID(), account: 'owner.near', operation: { kind: 'storage', contract: NATIVE_USDC, deposit: '1' }, nativeReservation: '1', createdAt: new Date().toISOString() })).toThrow('COMMERCE_LEGACY_PLAN_DISABLED');
  });
  it('registers storage for the vault, never the owner', async () => {
    vi.mocked(viewNear).mockResolvedValueOnce({ value: null, blockHash: 'fixture-finalized-block', blockHeight: 100 }).mockResolvedValueOnce({ value: { min: '100' }, blockHash: 'fixture-finalized-block', blockHeight: 100 });
    const plan = await planCommerceStorage(await budget(), 'token.testnet');
    if ('registered' in plan) throw new Error('fixture');
    expect(commerceCall(plan)).toMatchObject({ receiverId: 'token.testnet', methodName: 'storage_deposit', args: { account_id: policy.vault, registration_only: true } });
  });
  it('signs only the exact vault call once and returns the saved outcome on retry', async () => {
    const b = await budget(), plan = await planVaultPayment(b, '100', target, 'merchant'), o = owner();
    await executeCommercePlan(o, b, plan, commercePlanHash(plan), 'fixture-journal');
    await executeCommercePlan(o, b, plan, commercePlanHash(plan), 'fixture-journal');
    expect(submitOnce).toHaveBeenCalledTimes(1);
    const call = vi.mocked(submitOnce).mock.calls[0]!;
    expect(call[1]).toBe('testnet'); expect(call[3]).toBe(policy.vault);
    expect(call[4][0]!.functionCall?.methodName).toBe('execute_commerce_v1');
    expect(JSON.parse(Buffer.from(call[4][0]!.functionCall!.args).toString()).request.amount).toBe('100');
  });
  it('rechecks chain state immediately before signing and retains an uncertain dispatch without retry', async () => {
    const b = await budget(), plan = await planVaultPayment(b, '100', target, 'merchant');
    const changed = chain(); changed.budget.next_nonce = '8'; vi.mocked(readVault).mockResolvedValue(changed);
    await expect(executeCommercePlan(owner(), b, plan, commercePlanHash(plan), 'fixture-journal')).rejects.toThrow('COMMERCE_OUTCOME_UNRESOLVED');
    expect(submitOnce).not.toHaveBeenCalled();
    vi.mocked(readVault).mockResolvedValue(chain());
    await expect(executeCommercePlan(owner(), b, plan, commercePlanHash(plan), 'fixture-journal')).rejects.toThrow('COMMERCE_OUTCOME_UNRESOLVED');
    expect(submitOnce).not.toHaveBeenCalled();
  });
  it('preserves explicit public-lending consent and rejects debt-bearing vault positions', async () => {
    await expect(planLending(await budget({ ...policy, allowPublicLending: false }), 'supply', '1')).rejects.toThrow('PUBLIC_LENDING_DISABLED');
    const s = position(); s.position!.borrowed = [{ token_id: 'token.testnet', shares: '1', balance: '1' }]; vi.mocked(readLendingPosition).mockResolvedValue(s);
    await expect(planLending(await budget(), 'supply', '1')).rejects.toThrow('LENDING_DEBT_REQUIRES_SEPARATE_REVIEW');
  });
});

describe('Agent Market vault incompatibility', () => {
  it('never signs, reserves or dispatches an owner-wallet delegate, even with an approved quote', async () => {
    const q: AgentQuote = { format: 'neslos-agent-quote-v1', request: { handle: 'web-research', messageId: randomUUID(), brief: 'Review public Rhea documentation.' }, requirement: { scheme: 'exact', network: 'near:mainnet', asset: NATIVE_USDC, amount: '100000', payTo: 'market.near', maxTimeoutSeconds: 4200 }, quotedAt: new Date().toISOString(), maximumAmount: '100000' };
    const b = await budget(), reserve = vi.spyOn(b, 'once'), market = new AgentMarketClient(), dispatch = vi.spyOn(market, 'dispatch');
    await expect(payAgentJob(owner(), b, q, agentQuoteHash(q), market)).rejects.toThrow('AGENT_VAULT_PAYMENT_UNSUPPORTED');
    expect(reserve).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); expect(submitOnce).not.toHaveBeenCalled();
    await expect(planVaultPayment(b, '1', target, 'near-agent-market')).rejects.toThrow('AGENT_VAULT_PAYMENT_UNSUPPORTED');
  });
});
