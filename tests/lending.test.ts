import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { lendingCall, lendingPosition, observeLendingChange, readLendingPosition, type LendingPlan, type LendingSnapshot } from '../src/core/lending.js';
import { NATIVE_USDC } from '../src/core/research.js';

const snapshot = (): LendingSnapshot => ({
  format: 'neslos-rhea-snapshot-v1', network: 'mainnet', contract: 'contract.main.burrow.near', account: 'owner.near', token: NATIVE_USDC,
  asset: { token_id: NATIVE_USDC, supplied: { shares: '9000000000000000000', balance: '10000000000000000000' }, borrowed: { shares: '0', balance: '0' }, last_update_timestamp: '1793805000000000000',
    config: { extra_decimals: 12, can_deposit: true, can_withdraw: true, supplied_limit: '100000000000000000000' } },
  position: { account_id: 'owner.near', supplied: [{ token_id: NATIVE_USDC, shares: '1800000000000000000', balance: '2000000000000000001' }], borrowed: [] },
  walletBalance: '3000000', tokenDecimals: 6, blockHash: 'fixture-finalized-block', blockHeight: 123, fetchedAt: new Date().toISOString(),
});
const plan = (operation: LendingPlan['operation'] = 'supply'): LendingPlan => ({ format: 'neslos-rhea-plan-v1', operation, snapshot: snapshot(), amount: '1000000', maximumAmount: '1000000', allowPublicPosition: true, requestId: randomUUID() });

describe('Rhea lending protocol adapter', () => {
  it('constructs only the official non-collateral supply call', () => {
    expect(lendingCall(plan())).toEqual({ receiverId: NATIVE_USDC, methodName: 'ft_transfer_call', args: { receiver_id: 'contract.main.burrow.near', amount: '1000000', msg: '' }, gas: '180000000000000', deposit: '1' });
  });
  it('converts withdrawals with the actual extra decimals using integer arithmetic', () => {
    expect(lendingCall(plan('withdraw')).args).toEqual({ actions: [{ Withdraw: { token_id: NATIVE_USDC, max_amount: '1000000000000000000' } }] });
    expect(lendingPosition(snapshot())).toMatchObject({ underlyingAtomic: '2000000', protocolDust: '1', publicPosition: true });
  });
  it('requires explicit public-position consent and preserves the requested ceiling', () => {
    expect(() => lendingCall({ ...plan(), allowPublicPosition: false } as unknown as LendingPlan)).toThrow();
    expect(() => lendingCall({ ...plan(), amount: '1000001' })).toThrow('LENDING_AMOUNT_LIMIT');
    expect(() => lendingCall({ ...plan(), amount: '0' })).toThrow('LENDING_AMOUNT_LIMIT');
  });
  it('refuses an altered protocol, token or position identity', () => {
    for (const change of [{ contract: 'attacker.near' }, { token: 'different.near' }, { position: { account_id: 'other.near', supplied: [], borrowed: [] } }]) {
      expect(() => lendingCall({ ...plan(), snapshot: { ...snapshot(), ...change } })).toThrow('LENDING_IDENTITY_BINDING');
    }
  });
  it('refuses insufficient balance, unavailable deposits and the protocol supply ceiling', () => {
    const p = plan(); p.snapshot.walletBalance = '1';
    expect(() => lendingCall(p)).toThrow('LENDING_INSUFFICIENT_BALANCE');
    p.snapshot.walletBalance = '3000000'; p.snapshot.asset.config.can_deposit = false;
    expect(() => lendingCall(p)).toThrow('LENDING_DEPOSITS_DISABLED');
    p.snapshot.asset.config.can_deposit = true; p.snapshot.asset.config.supplied_limit = '10000000000000000000';
    expect(() => lendingCall(p)).toThrow('LENDING_SUPPLY_LIMIT');
  });
  it('will not turn a simple withdrawal into a debt or collateral operation', () => {
    const p = plan('withdraw');
    p.snapshot.position!.borrowed = [{ token_id: NATIVE_USDC, shares: '1', balance: '1' }];
    expect(() => lendingCall(p)).toThrow('LENDING_DEBT_REQUIRES_SEPARATE_REVIEW');
    p.snapshot.position = null;
    expect(() => lendingCall(p)).toThrow('LENDING_INSUFFICIENT_SUPPLIED');
  });
  it('refuses stale plans and unsafe protocol precision', () => {
    expect(() => lendingCall(plan(), Date.now() + 61000)).toThrow('LENDING_STALE_PLAN');
    const p = plan(); p.snapshot.tokenDecimals = 24; p.snapshot.asset.config.extra_decimals = 24;
    expect(() => lendingCall(p)).toThrow('LENDING_DECIMAL_RANGE');
  });
  it('binds every read to the same finalized block', async () => {
    const s = snapshot();
    const read = vi.fn(async (_contract, method, _args, _network, hash) => ({ value: method === 'get_asset' ? s.asset : method === 'get_account' ? s.position : method === 'ft_metadata' ? { decimals: 6 } : s.walletBalance, blockHash: hash ?? s.blockHash, blockHeight: 123 }));
    const result = await readLendingPosition(s.account, s.token, s.network, read);
    expect(result.blockHash).toBe(s.blockHash);
    for (const call of read.mock.calls.slice(1)) expect(call[4]).toBe(s.blockHash);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it('does not mistake a successful transfer for an observed lending position', () => {
    const before = snapshot(), after = structuredClone(before); after.blockHeight++;
    expect(observeLendingChange(before, after, 'supply').observed).toBe(false);
    after.position!.supplied[0]!.shares = '2700000000000000000';
    expect(observeLendingChange(before, after, 'supply')).toMatchObject({ observed: true, sharesDelta: '900000000000000000' });
    expect(() => observeLendingChange(before, before, 'supply')).toThrow('LENDING_OBSERVATION_NOT_NEW');
  });
});
