import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { actions, baseEncode, FailoverRpcError } from 'near-api-js';
import { AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import { submitOnce, transactionOutcome, type TransactionRecord } from '../src/owner/account.js';
import { testnetPlanSchema } from '../src/owner/testnet.js';
import { isMissingNearAccount, retryNearRead } from '../src/core/near.js';
import { completedProofSteps, proofCheckpoint, proofSteps } from '../src/owner/proof.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
// near-api-js v7 RpcTransactionResponse flattens the execution outcome.
const success = { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: {
  hash: baseEncode(createHash('sha256').update(new Uint8Array([1, 2, 3])).digest()), signer_id: 'owner.testnet', receiver_id: 'recipient.testnet',
} };
const failure = { ...success, status: { Failure: { ActionError: 'test rejection' } } };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'neslos-owner-')); directories.push(dir);
  // Transport fixtures only. No RPC or funded account is used by these tests.
  const create = vi.fn().mockResolvedValue({ transaction: { encode: () => new Uint8Array([1, 2, 3]) }, encode: () => new Uint8Array([4, 5, 6]) });
  const send = vi.fn().mockResolvedValue(success), observe = vi.fn().mockResolvedValue(success);
  const account = { accountId: 'owner.testnet', createSignedTransaction: create, provider: { sendTransactionUntil: send, viewTransactionStatus: observe } } as unknown as Parameters<typeof submitOnce>[0];
  return { path: join(dir, 'transaction.json'), account, create, send, observe, action: [actions.transfer(1n)] };
}

describe('owner transaction recovery', () => {
  it('writes the exact signed bytes before broadcast and never repeats a completed transfer', async () => {
    const f = await fixture();
    f.send.mockImplementation(async () => {
      const saved = JSON.parse(await readFile(f.path, 'utf8'));
      expect(saved).toMatchObject({ state: 'prepared', signedTransaction: 'BAUG', network: 'testnet' });
      return success;
    });
    const first = await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    const second = await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    expect(second.hash).toBe(first.hash); expect(first.state).toBe('final');
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('after a timeout observes the retained hash without signing or sending again', async () => {
    const f = await fixture(); f.send.mockRejectedValue(new Error('Connection lost after broadcast'));
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_UNKNOWN');
    const recovered = await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    expect(recovered.state).toBe('final'); expect(f.observe).toHaveBeenCalledWith(expect.objectContaining({ txHash: recovered.hash, waitUntil: 'FINAL' }));
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('keeps an unresolved transfer unresolved without refunding or resending it', async () => {
    const f = await fixture(); f.send.mockRejectedValue(new Error('timeout')); f.observe.mockRejectedValue(new Error('unknown transaction'));
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_UNKNOWN');
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_UNKNOWN');
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('rejects changed amounts, recipients, or network for an existing operation', async () => {
    const f = await fixture(); await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    for (const [network, recipient, list] of [
      ['testnet', 'recipient.testnet', [actions.transfer(2n)]],
      ['testnet', 'other.testnet', f.action], ['mainnet', 'recipient.testnet', f.action],
    ] as const) await expect(submitOnce(f.account, network, f.path, recipient, [...list])).rejects.toThrow('TRANSACTION_CONFLICT');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('records a chain failure without presenting it as success or automatically retrying', async () => {
    const f = await fixture(); f.send.mockResolvedValue(failure);
    const result = await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    expect(transactionOutcome(result.outcome)).toEqual({ final: true, success: false });
    await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(transactionOutcome({ final_execution_status: 'EXECUTED' }).final).toBe(false);
  });
  it('allows at most one broadcast when processes compete for the same journal', async () => {
    const f = await fixture();
    await Promise.allSettled(Array.from({ length: 2 }, () => submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)));
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('can retry SDK preparation reads before broadcasting, without retrying the transfer', async () => {
    const f = await fixture(); f.create.mockRejectedValueOnce(new TypeError('fetch failed'));
    await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    expect(f.create).toHaveBeenCalledTimes(2); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([{ hash: 'another-transaction' }, { signer_id: 'another.testnet' }, { receiver_id: 'another.testnet' }])('does not finalize a mismatched RPC transaction %j', async change => {
    const f = await fixture();
    f.send.mockResolvedValue({ ...success, transaction: { ...success.transaction, ...change } });
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_RESULT_BINDING');
    expect(JSON.parse(await readFile(f.path, 'utf8')).state).toBe('prepared');
    const recovered = await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    expect(recovered.state).toBe('final');
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('keeps a mismatched recovery response unresolved and rejects an invalid cached final receipt', async () => {
    const f = await fixture(); f.send.mockRejectedValue(new Error('timeout'));
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_UNKNOWN');
    f.observe.mockResolvedValue({ ...success, transaction: { ...success.transaction, hash: 'another-transaction' } });
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_UNKNOWN');
    expect(JSON.parse(await readFile(f.path, 'utf8')).state).toBe('prepared');
    f.observe.mockResolvedValue(success);
    await submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action);
    const saved = JSON.parse(await readFile(f.path, 'utf8'));
    saved.outcome.transaction.receiver_id = 'another.testnet';
    const { writeFile } = await import('node:fs/promises');
    await writeFile(f.path, JSON.stringify(saved));
    await expect(submitOnce(f.account, 'testnet', f.path, 'recipient.testnet', f.action)).rejects.toThrow('TRANSACTION_RESULT_BINDING');
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('does not interpret incomplete or contradictory status fields as final success', () => {
    for (const value of [null, undefined, { final_execution_status: 'FINAL' }, { ...success, status: { SuccessValue: 1 } }, { ...success, status: { SuccessValue: '', Failure: {} } }]) {
      expect(transactionOutcome(value)).toEqual({ final: false, success: false });
    }
    expect(transactionOutcome({ ...success, final_execution_status: 'EXECUTED' })).toEqual({ final: false, success: false });
  });
});

describe('bounded testnet deployment plans', () => {
  const p = {
    format: 'neslos-testnet-plan-v1', network: 'testnet', owner: 'owner.testnet', ownerPublicKey: 'ed25519:test-public-key',
    vault: 'vault.owner.testnet', token: 'token.owner.testnet', vaultFunding: '3000000000000000000000000', tokenFunding: '2000000000000000000000000',
    vaultSha256: 'a'.repeat(64), tokenSha256: 'b'.repeat(64), executorPublicKey: 'c'.repeat(64), supply: '1000000000',
    policy: { daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, max_quote_age_ms: '60000', venue_commitments: ['d'.repeat(64)], counterparty_commitments: ['e'.repeat(64)], output_assets: ['nep141:token.owner.testnet'], require_confidential: false, paused: true },
    disclosure: 'Public testnet contract demonstration. Test fixture token; local executor; no TEE or Intents claim.',
  };
  it('accepts the reviewed testnet scope and rejects mainnet, unrelated accounts, excessive funding, and false privacy claims', () => {
    expect(testnetPlanSchema.parse(p).network).toBe('testnet');
    for (const changed of [
      { network: 'mainnet' }, { vault: 'other.testnet' }, { vaultFunding: '9000000000000000000000000' },
      { policy: { ...p.policy, require_confidential: true } }, { policy: { ...p.policy, paused: false } },
    ]) expect(() => testnetPlanSchema.parse({ ...p, ...changed })).toThrow();
  });
  it('retains charged spending through the failed-transfer and policy-change recovery checkpoints', () => {
    const plan = testnetPlanSchema.parse(p);
    expect(proofCheckpoint(plan, 5)).toMatchObject({ used: '150000000', nonce: '2', vaultBalance: '850000000', record1: 'DispatchFailed' });
    expect(proofCheckpoint(plan, 6)).toMatchObject({ used: '150000000', policyVersion: '3', policy: { daily_limit: '100000000' } });
    expect(proofCheckpoint(plan, 12)).toMatchObject({ used: '150000000', nonce: '2', vaultBalance: '800000000', ownerBalance: '200000000', policy: { paused: true } });
    expect(() => proofCheckpoint(plan, -1)).toThrow('CHECKPOINT');
  });
});

describe('account absence through the NEAR SDK', () => {
  const account = 'vault.owner.testnet';
  const missing = () => new AccountDoesNotExistError(account, 'block-hash', 123);
  it('recognizes finalized absence through the SDK failover wrapper', () => {
    expect(isMissingNearAccount(missing(), account)).toBe(true);
    expect(isMissingNearAccount(new FailoverRpcError(2, [missing(), missing()]), account)).toBe(true);
  });
  it('does not fund on an uncertain lookup or a different missing account', () => {
    expect(isMissingNearAccount(new FailoverRpcError(2, [missing(), new Error('fetch failed')]), account)).toBe(false);
    expect(isMissingNearAccount(new FailoverRpcError(0, []), account)).toBe(false);
    expect(isMissingNearAccount(new AccountDoesNotExistError('other.testnet', 'block-hash', 123), account)).toBe(false);
    expect(isMissingNearAccount(new Error('Account does not exist'), account)).toBe(false);
  });
});

describe('bounded RPC read retries', () => {
  it('handles Node fetch failures wrapped by the official failover provider', async () => {
    const read = vi.fn().mockRejectedValueOnce(new FailoverRpcError(2, [new TypeError('fetch failed'), new TypeError('fetch failed')])).mockResolvedValue('finalized view');
    expect(await retryNearRead(read)).toBe('finalized view');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('stops after three transport failures and does not retry contract errors', async () => {
    const read = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(retryNearRead(read)).rejects.toThrow('fetch failed'); expect(read).toHaveBeenCalledTimes(3);
    const rejected = vi.fn().mockRejectedValue(new Error('PER_ACTION_LIMIT'));
    await expect(retryNearRead(rejected)).rejects.toThrow('PER_ACTION_LIMIT'); expect(rejected).toHaveBeenCalledTimes(1);
  });
});

describe('testnet proof journal recovery', () => {
  const record = (outcome: unknown = success, state: TransactionRecord['state'] = 'final'): TransactionRecord => ({
    format: 'neslos-owner-transaction-v1', network: 'testnet', signer: 'owner.testnet', receiver: 'vault.owner.testnet',
    fingerprint: 'fixture', hash: 'fixture', signedTransaction: 'fixture', state, outcome,
  });
  const rejected = (reason: string) => record({ final_execution_status: 'FINAL', status: { Failure: { ExecutionError: reason } } });
  const prefix = (): (TransactionRecord | undefined)[] => [record(), record(), rejected('PER_ACTION_LIMIT'), rejected('NONCE'), record(), ...Array(proofSteps.length - 5).fill(undefined)];
  it('resumes after confirmed dispatch failure without treating it as a second spending opportunity', () => {
    expect(completedProofSteps(prefix())).toBe(5);
  });
  it('refuses missing earlier receipts, unresolved transactions, and the wrong rejection reason', () => {
    const gap = prefix(); gap[1] = undefined;
    const unresolved = prefix(); unresolved[4] = record(undefined, 'prepared');
    const wrongReason = prefix(); wrongReason[2] = rejected('STALE_QUOTE');
    for (const rows of [gap, unresolved, wrongReason]) expect(() => completedProofSteps(rows)).toThrow('JOURNAL_UNRESOLVED');
  });
});
