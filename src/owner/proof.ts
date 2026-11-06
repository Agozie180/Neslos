import { readFile } from 'node:fs/promises';
import { actions, teraToGas, nearToYocto } from 'near-api-js';
import { canonical, sha256, signHash } from '../core/crypto.js';
import { readVault, retryNearRead, viewNear } from '../core/near.js';
import { signAuthorization, settlementBytes, type Authorization, type SettlementWire } from '../core/wire.js';
import { connectOwner, submitOnce, transactionOutcome, verifyTransactionOutcome, writePrivateJson, json, type TransactionRecord } from './account.js';
import { loadTestExecutor, testnetPlanSchema, type TestnetPlan } from './testnet.js';

export const proofSteps = ['resume', 'allowed', 'overspend', 'replay', 'dispatch-failure', 'lower-limit', 'exhausted', 'restore-policy', 'settlement', 'pause', 'paused', 'owner-recovery'] as const;
const rejections: Record<string, string> = { overspend: 'PER_ACTION_LIMIT', replay: 'NONCE', exhausted: 'DAILY_LIMIT', paused: 'PAUSED' };

export function proofCheckpoint(plan: TestnetPlan, completed: number) {
  if (!Number.isInteger(completed) || completed < 0 || completed > proofSteps.length) throw new Error('TESTNET_PROOF_CHECKPOINT');
  const version = completed >= 10 ? '5' : completed >= 8 ? '4' : completed >= 6 ? '3' : completed >= 1 ? '2' : '1';
  const reduced = completed >= 6 && completed < 8;
  const used = completed >= 2 ? '150000000' : '0';
  return {
    policyVersion: version,
    policy: { ...plan.policy, paused: completed === 0 || completed >= 10,
      ...(reduced ? { daily_limit: '100000000', per_action_limit: '100000000' } : {}) },
    used, nonce: completed >= 5 ? '2' : completed >= 2 ? '1' : '0',
    vaultBalance: completed === 12 ? '800000000' : completed >= 2 ? '850000000' : plan.supply,
    ownerBalance: completed === 12 ? '200000000' : completed >= 2 ? '150000000' : '0',
    record0: completed >= 9 ? 'Settled' : completed >= 2 ? 'Dispatched' : undefined,
    record1: completed >= 5 ? 'DispatchFailed' : undefined,
  };
}
/** Only a contiguous prefix of finalized, expected outcomes can be resumed. */
export function completedProofSteps(records: (TransactionRecord | undefined)[]) {
  if (records.length !== proofSteps.length) throw new Error('TESTNET_PROOF_JOURNAL_LENGTH');
  let completed = 0, gap = false;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) { gap = true; continue; }
    const expected = !rejections[proofSteps[i]!], outcome = transactionOutcome(record.outcome);
    if (gap || record.state !== 'final' || !outcome.final || outcome.success !== expected
      || (!expected && !json(record.outcome).includes(rejections[proofSteps[i]!]!))) throw new Error('TESTNET_PROOF_JOURNAL_UNRESOLVED: ' + proofSteps[i]);
    completed++;
  }
  return completed;
}

async function readOptional<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Public test-token exercise, recoverable only from verified receipts and matching state. */
export async function proveTestnet(owner: Awaited<ReturnType<typeof connectOwner>>, input: unknown, privateDir: string) {
  const p = testnetPlanSchema.parse(input), executor = await loadTestExecutor(privateDir + '/executor.json');
  if (owner.network !== 'testnet' || owner.account.accountId !== p.owner || executor.publicKey !== p.executorPublicKey) throw new Error('TESTNET_PROOF_OWNER_OR_EXECUTOR_MISMATCH');
  const journal = (step: string) => privateDir + '/transactions/proof-' + step + '.json';
  if (await readOptional(journal('failure-pause'))) throw new Error('TESTNET_PROOF_PAUSED_AFTER_FAILURE: reconcile the owner pause before starting a new proof; do not reset or remove journals.');
  const records: (TransactionRecord | undefined)[] = [];
  for (const step of proofSteps) {
    const path = journal(step), saved = await readOptional<TransactionRecord>(path);
    if (!saved) { records.push(undefined); continue; }
    if (saved.format !== 'neslos-owner-transaction-v1' || saved.network !== 'testnet' || saved.signer !== p.owner || saved.receiver !== p.vault) throw new Error('TESTNET_PROOF_JOURNAL_DOMAIN');
    // Even locally final records are checked against the chain before recovery.
    const outcome = await retryNearRead(() => owner.provider.viewTransactionStatus({ txHash: saved.hash, accountId: p.owner, waitUntil: 'FINAL' }));
    verifyTransactionOutcome(outcome, saved);
    const reconciled: TransactionRecord = { ...saved, state: 'final', outcome };
    await writePrivateJson(path, reconciled);
    records.push(reconciled);
  }
  const completed = completedProofSteps(records);
  const results: { step: string; hash: string; success: boolean; explorer: string }[] = [];
  const checkpoint = async (count: number) => {
    const expected = proofCheckpoint(p, count), vault = await readVault(p.vault, 'testnet');
    if (vault.config.owner_id !== p.owner || vault.config.token_id !== p.token || vault.config.executor_public_key !== p.executorPublicKey
      || vault.config.policy_version !== expected.policyVersion || canonical(vault.config.policy) !== canonical(expected.policy)
      || vault.budget.used !== expected.used || vault.budget.next_nonce !== expected.nonce || vault.balance !== expected.vaultBalance) throw new Error('TESTNET_PROOF_STATE_MISMATCH: checkpoint ' + count);
    const received = await viewNear(p.token, 'ft_balance_of', { account_id: p.owner }, 'testnet', vault.blockHash);
    if (received.value !== expected.ownerBalance) throw new Error('TESTNET_PROOF_RECIPIENT_MISMATCH');
    for (const [nonce, status] of [['0', expected.record0], ['1', expected.record1]]) {
      if (!status) continue;
      const record = (await viewNear(p.vault, 'get_record', { nonce }, 'testnet', vault.blockHash)).value;
      if (record?.status !== status || record.day !== vault.budget.day) throw new Error('TESTNET_PROOF_RECORD_MISMATCH');
    }
    return { vault, ownerBalance: received.value as string };
  };
  let verifiedCheckpoint = await checkpoint(completed);

  const signed = async (step: string, amount: string, nonce: string, version: string, receiver = p.owner) => {
    const path = privateDir + '/authorization-' + step + '.json';
    const existing = await readOptional<ReturnType<typeof signAuthorization>>(path);
    if (existing && await readOptional(journal(step))) return existing;
    // A saved authorization with no transaction can be refreshed: nothing was broadcast.
    const block = await retryNearRead(() => owner.provider.viewBlock({ finality: 'final' }));
    const now = Math.floor(Number(block.header.timestamp_nanosec) / 1_000_000);
    const authorization: Authorization = {
      domain: 'neslos:authorize:v1', network: 'testnet', vault: p.vault, policy_version: version, nonce,
      amount, quoted_output: amount, minimum_output: amount, slippage_bps: 0,
      quoted_at_ms: String(now), expires_at_ms: String(now + 60_000),
      venue_commitment: p.policy.venue_commitments[0]!, strategy_venue_commitment: null,
      counterparty_commitment: p.policy.counterparty_commitments[0]!, deposit_account: receiver,
      output_asset: 'nep141:' + p.token, quote_hash: sha256(canonical({ step, amount, receiver, testnetOnly: true })),
      confidential: false, action: 0, audit_hash: sha256(canonical({ step, plan: p, disclosure: p.disclosure })),
    };
    const result = signAuthorization(authorization, executor.signingKey);
    await writePrivateJson(path, result);
    return result;
  };
  const authorizeArgs = async (step: string, amount: string, nonce: string, version: string, receiver = p.owner) => {
    const result = await signed(step, amount, nonce, version, receiver);
    return { authorization: result.authorization, signature: result.signature };
  };
  const steps: { method: string; args: () => Promise<Record<string, unknown>>; deposit?: bigint }[] = [
    { method: 'set_paused', args: async () => ({ paused: false, expected_version: '1' }) },
    { method: 'authorize', args: () => authorizeArgs('allowed', '150000000', '0', '2'), deposit: nearToYocto('0.01') },
    { method: 'authorize', args: () => authorizeArgs('overspend', '201000000', '1', '2'), deposit: nearToYocto('0.01') },
    { method: 'authorize', args: () => authorizeArgs('allowed', '150000000', '0', '2'), deposit: nearToYocto('0.01') },
    { method: 'authorize', args: () => authorizeArgs('dispatch-failure', '50000000', '1', '2', 'unregistered.' + p.owner), deposit: nearToYocto('0.01') },
    { method: 'set_policy', args: async () => ({ policy: { ...p.policy, daily_limit: '100000000', per_action_limit: '100000000', paused: false }, expected_version: '2' }) },
    { method: 'authorize', args: () => authorizeArgs('exhausted', '1000000', '2', '3'), deposit: nearToYocto('0.01') },
    { method: 'set_policy', args: async () => ({ policy: { ...p.policy, paused: false }, expected_version: '3' }) },
    { method: 'record_settlement', args: async () => {
      const allowed = await signed('allowed', '150000000', '0', '2');
      const settlement: SettlementWire = { domain: 'neslos:settlement:v1', network: 'testnet', vault: p.vault, nonce: '0', quote_hash: allowed.authorization.quote_hash, outcome: 1, audit_hash: sha256(canonical({ received: '150000000', authorizationHash: allowed.hash, testnetOnly: true })) };
      return { settlement, signature: signHash(sha256(settlementBytes(settlement)), executor.signingKey) };
    } },
    { method: 'set_paused', args: async () => ({ paused: true }) },
    { method: 'authorize', args: () => authorizeArgs('paused', '1000000', '2', '5'), deposit: nearToYocto('0.01') },
    { method: 'withdraw_owner', args: async () => ({ amount: '50000000' }), deposit: 1n },
  ];
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!, name = proofSteps[i]!;
      // submitOnce compares exact fingerprints for completed steps and returns
      // their saved receipts, without signing or broadcasting them again.
      const receipt = await submitOnce(owner.account, 'testnet', journal(name), p.vault, [actions.functionCall(step.method, await step.args(), teraToGas('100'), step.deposit ?? 0n)]);
      const result = transactionOutcome(receipt.outcome), reason = rejections[name];
      if (!result.final || result.success !== !reason || (reason && !json(receipt.outcome).includes(reason))) throw new Error('TESTNET_PROOF_FAILED: ' + name + '; inspect ' + receipt.hash);
      results.push({ step: name, hash: receipt.hash, success: result.success, explorer: 'https://testnet.nearblocks.io/txns/' + receipt.hash });
      if (i >= completed) verifiedCheckpoint = await checkpoint(i + 1);
      console.log(json({ step: name, transactionHash: receipt.hash, resumed: i < completed, expectedOutcomeVerified: true }));
    }
    const { vault: final, ownerBalance } = verifiedCheckpoint;
    return { format: 'neslos-testnet-proof-v1', success: true, network: 'testnet', vault: p.vault, token: p.token, owner: p.owner, results, budget: final.budget, vaultTokenBalance: final.balance, ownerTokenBalance: ownerBalance, blockHash: final.blockHash, verifiedAt: new Date().toISOString(), disclosure: p.disclosure };
  } catch (error) {
    try {
      const paused = await submitOnce(owner.account, 'testnet', journal('failure-pause'), p.vault, [actions.functionCall('set_paused', { paused: true }, teraToGas('100'), 0n)]);
      if (!transactionOutcome(paused.outcome).success) throw new Error('OWNER_PAUSE_FAILED: ' + paused.hash);
    } catch (pauseError) { throw new AggregateError([error, pauseError], 'TESTNET_PROOF_INTERRUPTED: reconcile saved transactions and owner pause.'); }
    throw error;
  }
}
