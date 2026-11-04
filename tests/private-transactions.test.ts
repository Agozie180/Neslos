import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: vi.fn(), attest: vi.fn() }));
vi.mock('../src/core/near.js', async original => ({ ...await original<typeof import('../src/core/near.js')>(), readVault: mocks.state }));
vi.mock('../src/core/private-client.js', () => ({ attestEndpoint: mocks.attest }));
import { keyFromSeed, canonical, sha256 } from '../src/core/crypto.js';
import { signAuthorization, type Authorization } from '../src/core/wire.js';
import { executeTransactionPlan, makeTransactionPlan, planHash, plannedCall } from '../src/owner/transactions.js';
import type { OwnerRuntime, PrivateJob } from '../src/owner/private.js';

// Test-only signing identity and RPC transport. No public-chain transaction is sent.
const identity = keyFromSeed(new Uint8Array(32).fill(17));
const config: OwnerRuntime = { format: 'neslos-owner-runtime-v1', network: 'mainnet', vault: 'vault.near', endpoint: 'https://fixture.invalid', executorPublicKey: identity.publicKey, teePolicy: { format: 'neslos-tdx-policy-v1', mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48), rtMr3: '55'.repeat(48) } };
let directory: string;
beforeEach(async () => { vi.resetAllMocks(); directory = await mkdtemp(join(tmpdir(), 'neslos-private-tx-')); mocks.state.mockResolvedValue({ config: { owner_id: 'owner.near', policy_version: '1', executor_public_key: identity.publicKey }, budget: { next_nonce: '0' } }); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function ownerFixture() {
  const create = vi.fn().mockResolvedValue({ transaction: { encode: () => new Uint8Array([1, 2, 3]) }, encode: () => new Uint8Array([4, 5, 6]) });
  const success = { final_execution_status: 'FINAL', status: { SuccessValue: '' } };
  const send = vi.fn().mockResolvedValue(success), observe = vi.fn().mockResolvedValue(success);
  const owner = { network: 'mainnet', account: { accountId: 'owner.near', createSignedTransaction: create, provider: { sendTransactionUntil: send, viewTransactionStatus: observe } } } as unknown as Parameters<typeof executeTransactionPlan>[0];
  return { owner, create, send, observe };
}
function preparedJob(): PrivateJob {
  const a: Authorization = { domain: 'neslos:authorize:v1', network: 'mainnet', vault: config.vault, policy_version: '1', nonce: '0', amount: '1000000', quoted_output: '1000000', minimum_output: '995000', slippage_bps: 50,
    quoted_at_ms: String(Date.now()), expires_at_ms: String(Date.now() + 60000), venue_commitment: '66'.repeat(32), strategy_venue_commitment: null, counterparty_commitment: '77'.repeat(32), deposit_account: 'deposit.near', output_asset: 'nep141:usdt.tether-token.near', quote_hash: '88'.repeat(32), confidential: true, action: 0, audit_hash: '99'.repeat(32) };
  const signed = signAuthorization(a, identity.privateKey);
  const transaction = { receiverId: config.vault, actions: [{ type: 'FunctionCall', params: { methodName: 'authorize', args: { authorization: a, signature: signed.signature }, gas: '100000000000000', deposit: '10000000000000000000000' } }] };
  return { format: 'neslos-private-job-v1', configHash: sha256(canonical(config)), command: { type: 'observe', id: '00000000-0000-4000-8000-000000000000', authorizationHash: signed.hash }, state: 'complete', result: { signed, transaction } };
}
describe('reviewed private transaction workflow', () => {
  it('reconstructs an exact signed call instead of executing an arbitrary returned action', async () => {
    const job = preparedJob(), plan = await makeTransactionPlan(config, undefined, job);
    expect(plannedCall(plan)).toEqual((job.result as any).transaction);
    (job.result as any).transaction.receiverId = 'attacker.near';
    await expect(makeTransactionPlan(config, undefined, job)).rejects.toThrow('TRANSACTION_SUBSTITUTION');
  });
  it('rejects changes to an authorization covered by the executor signature', async () => {
    const job = preparedJob(); (job.result as any).transaction.actions[0].params.args.authorization.amount = '999999999';
    await expect(makeTransactionPlan(config, undefined, job)).rejects.toThrow('AUTHORIZATION_BINDING');
  });
  it('requires the exact plan hash and an explicit mainnet opt-in before signing', async () => {
    const plan = await makeTransactionPlan(config, { kind: 'pause', paused: true }), f = ownerFixture();
    await expect(executeTransactionPlan(f.owner, plan, 'ff'.repeat(32), directory, true)).rejects.toThrow('PLAN_APPROVAL_HASH');
    await expect(executeTransactionPlan(f.owner, plan, planHash(plan), directory)).rejects.toThrow('MAINNET_OPT_IN_REQUIRED');
    expect(f.create).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('reconciles a lost transaction after chain state changes without signing a replacement', async () => {
    const plan = await makeTransactionPlan(config, undefined, preparedJob()), f = ownerFixture();
    f.send.mockRejectedValue(new Error('timeout'));
    await expect(executeTransactionPlan(f.owner, plan, planHash(plan), directory, true)).rejects.toThrow('TRANSACTION_UNKNOWN');
    mocks.state.mockRejectedValue(new Error('policy changed or RPC unavailable'));
    const recovered = await executeTransactionPlan(f.owner, plan, planHash(plan), directory, true);
    expect(recovered.state).toBe('final'); expect(f.create).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1); expect(f.observe).toHaveBeenCalledTimes(1);
  });
  it('rejects stale policy before preparing a new transaction', async () => {
    const plan = await makeTransactionPlan(config, { kind: 'pause', paused: true }), f = ownerFixture();
    mocks.state.mockResolvedValue({ config: { owner_id: 'owner.near', policy_version: '2' } });
    await expect(executeTransactionPlan(f.owner, plan, planHash(plan), directory, true)).rejects.toThrow('PLAN_STATE_CHANGED');
    expect(f.create).not.toHaveBeenCalled();
  });
  it('verifies fresh hardware identity both when planning and before pinning an executor', async () => {
    const plan = await makeTransactionPlan(config, { kind: 'pin-executor' }), f = ownerFixture();
    await executeTransactionPlan(f.owner, plan, planHash(plan), directory, true);
    expect(mocks.attest).toHaveBeenCalledTimes(2);
    expect(mocks.attest).toHaveBeenCalledWith(config.endpoint, config.teePolicy, config.executorPublicKey);
  });
});
