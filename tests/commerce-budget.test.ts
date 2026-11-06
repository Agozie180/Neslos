import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CommerceBudget, type CommercePolicy } from '../src/owner/commerce-budget.js';

const policy: CommercePolicy = { format: 'neslos-commerce-policy-v1', account: 'owner.near', network: 'mainnet', totalLimitAtomic: '100', perActionLimitAtomic: '60', totalNativeLimitYocto: '20', allowPublicLending: true, allowedAgentHandles: ['web-research'] };
const setup = async () => { const dir = await mkdtemp(join(tmpdir(), 'neslos-commerce-')); return { dir, budget: new CommerceBudget(dir, policy) }; };
const operation = () => ({ id: randomUUID(), kind: 'lending-supply' as const, amount: '60', nativeAmount: '1', input: { payee: 'market.near' } });

describe('durable commerce allowance', () => {
  it('reserves before preparing and saves preparation before dispatch; restart never pays twice', async () => {
    const { budget, dir } = await setup(), op = operation();
    const prepare = vi.fn(async () => {
      expect(JSON.parse(await readFile(join(dir, 'commerce.json'), 'utf8')).entries[0].state).toBe('reserved');
      return { exactSignature: 'fixture' };
    });
    const dispatch = vi.fn(async () => {
      expect(JSON.parse(await readFile(join(dir, 'commerce.json'), 'utf8')).entries[0]).toMatchObject({ state: 'submitted', preparation: { exactSignature: 'fixture' } });
      return { taskId: 'task' };
    });
    await expect(budget.once(op, prepare, dispatch)).resolves.toEqual({ taskId: 'task' });
    await expect(new CommerceBudget(dir, policy).once(op, prepare, dispatch)).resolves.toEqual({ taskId: 'task' });
    expect(prepare).toHaveBeenCalledTimes(1); expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('retains uncertain payments and rejects changed input and lifetime overrun', async () => {
    const { budget } = await setup(), op = operation(), send = vi.fn(async () => { throw new Error('Lost reply'); });
    await expect(budget.once(op, async () => ({}), send)).rejects.toThrow('COMMERCE_OUTCOME_UNRESOLVED');
    await expect(budget.once(op, async () => ({}), send)).rejects.toThrow('COMMERCE_OUTCOME_UNRESOLVED');
    await expect(budget.once({ ...op, input: {} }, async () => ({}), send)).rejects.toThrow('COMMERCE_OPERATION_CONFLICT');
    await expect(budget.once(operation(), async () => ({}), send)).rejects.toThrow('COMMERCE_BUDGET_EXHAUSTED');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await budget.status()).toMatchObject({ reservedAtomic: '60', reservedNativeYocto: '1' });
  });
  it('caps gas/storage separately and withdrawals never replenish principal allowance', async () => {
    const { budget } = await setup();
    await budget.once(operation(), async () => ({}), async () => ({}));
    await budget.once({ ...operation(), kind: 'lending-withdraw', amount: '0', nativeAmount: '19' }, async () => ({}), async () => ({}));
    await expect(budget.once({ ...operation(), kind: 'storage', amount: '0' }, async () => ({}), async () => ({}))).rejects.toThrow('COMMERCE_NATIVE_BUDGET_EXHAUSTED');
    expect(await budget.status()).toMatchObject({ reservedAtomic: '60', reservedNativeYocto: '20' });
  });
  it('will not recreate missing initialized history or load it for another account', async () => {
    const { budget, dir } = await setup(); await budget.status();
    await expect(new CommerceBudget(dir, { ...policy, account: 'other.near' }).status()).rejects.toThrow('COMMERCE_ACCOUNT_CONFLICT');
    await unlink(join(dir, 'commerce.json'));
    await expect(budget.status()).rejects.toThrow('COMMERCE_JOURNAL_MISSING');
  });
  it('prevents concurrent operations and only updates evidence after observation succeeds', async () => {
    const { budget } = await setup(), op = operation();
    await budget.once(op, async () => ({}), async () => {
      await expect(budget.status()).rejects.toThrow('COMMERCE_BUSY'); return { verified: false };
    });
    await expect(budget.observe(op.id, async () => { throw new Error('Invalid proof'); })).rejects.toThrow('Invalid proof');
    expect((await budget.operation(op.id)).result).toEqual({ verified: false });
  });
});
