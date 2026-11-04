import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { actions } from 'near-api-js';
import { z } from 'zod';
import { units } from '../core/amounts.js';
import { canonical, sha256, verifyHash } from '../core/crypto.js';
import { readVault, viewNear } from '../core/near.js';
import { attestEndpoint } from '../core/private-client.js';
import { authorizationBytes, authorizationSchema, chainPolicySchema, hashHex, nearAccount, settlementBytes } from '../core/wire.js';
import { connectOwner, submitOnce } from './account.js';
import { ownerRuntimeSchema, type OwnerRuntime, type PrivateJob } from './private.js';

const signature = z.string().regex(/^[a-f0-9]{128}$/);
const settlementSchema = z.object({ domain: z.literal('neslos:settlement:v1'), network: z.enum(['mainnet', 'testnet']), vault: nearAccount, nonce: z.string(), quote_hash: hashHex, outcome: z.union([z.literal(0), z.literal(1), z.literal(2)]), audit_hash: hashHex }).strict();
const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authorize'), authorization: authorizationSchema, signature }).strict(),
  z.object({ kind: z.literal('settle'), settlement: settlementSchema, signature }).strict(),
  z.object({ kind: z.literal('policy'), policy: chainPolicySchema }).strict(),
  z.object({ kind: z.literal('pin-executor') }).strict(),
  z.object({ kind: z.literal('pause'), paused: z.boolean() }).strict(),
  z.object({ kind: z.literal('withdraw'), amount: z.string().refine(v => { try { return units(v) > 0n; } catch { return false; } }) }).strict(),
  z.object({ kind: z.literal('fund'), tokenId: nearAccount, amount: z.string().refine(v => { try { return units(v) > 0n; } catch { return false; } }) }).strict(),
  z.object({ kind: z.literal('register-token'), tokenId: nearAccount, accountId: nearAccount, deposit: z.string().refine(v => { try { return units(v) > 0n && units(v) <= 10n ** 24n; } catch { return false; } }) }).strict(),
]);
export const transactionPlanSchema = z.object({
  format: z.literal('neslos-private-transaction-plan-v1'), config: ownerRuntimeSchema, owner: nearAccount,
  policyVersion: z.string().regex(/^(0|[1-9][0-9]*)$/), operation: operationSchema,
  intentId: z.string().uuid().optional(),
}).strict();
type Plan = z.infer<typeof transactionPlanSchema>;
export const planHash = (plan: Plan) => sha256(canonical(transactionPlanSchema.parse(plan)));
export function plannedCall(plan: Plan) {
  const p = transactionPlanSchema.parse(plan), op = p.operation, c = p.config;
  let methodName: string, args: Record<string, unknown>, gas = '30000000000000', deposit = '0', receiverId = c.vault;
  if (op.kind === 'authorize') {
    const a = op.authorization;
    if (a.network !== c.network || a.vault !== c.vault || !a.confidential || a.policy_version !== p.policyVersion || !verifyHash(sha256(authorizationBytes(a)), op.signature, c.executorPublicKey)) throw new Error('AUTHORIZATION_BINDING');
    methodName = 'authorize'; args = { authorization: a, signature: op.signature }; gas = '100000000000000'; deposit = '10000000000000000000000';
  } else if (op.kind === 'settle') {
    if (op.settlement.network !== c.network || op.settlement.vault !== c.vault || !verifyHash(sha256(settlementBytes(op.settlement)), op.signature, c.executorPublicKey)) throw new Error('SETTLEMENT_BINDING');
    methodName = 'record_settlement'; args = { settlement: op.settlement, signature: op.signature };
  } else if (op.kind === 'policy') {
    methodName = 'set_policy'; args = { policy: op.policy, expected_version: p.policyVersion };
  } else if (op.kind === 'pin-executor') {
    methodName = 'set_executor_key'; args = { public_key: c.executorPublicKey, expected_version: p.policyVersion };
  } else if (op.kind === 'pause') {
    methodName = 'set_paused'; args = { paused: op.paused };
  } else if (op.kind === 'fund') {
    receiverId = op.tokenId; methodName = 'ft_transfer'; args = { receiver_id: c.vault, amount: op.amount }; deposit = '1';
  } else if (op.kind === 'register-token') {
    if (![c.vault, p.owner].includes(op.accountId)) throw new Error('STORAGE_ACCOUNT_BINDING');
    receiverId = op.tokenId; methodName = 'storage_deposit'; args = { account_id: op.accountId, registration_only: true }; deposit = op.deposit;
  } else {
    methodName = 'withdraw_owner'; args = { amount: op.amount }; gas = '50000000000000'; deposit = '1';
  }
  return { receiverId, actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }] };
}
export async function makeTransactionPlan(config: OwnerRuntime, input: unknown, job?: PrivateJob, expectedVersion?: string): Promise<Plan> {
  const state = await readVault(config.vault, config.network);
  if (expectedVersion !== undefined && state.config.policy_version !== expectedVersion) throw new Error('PLAN_STATE_CHANGED');
  let operation: z.infer<typeof operationSchema>;
  if (job) {
    if (job.format !== 'neslos-private-job-v1' || job.state !== 'complete' || job.configHash !== sha256(canonical(config))) throw new Error('PRIVATE_JOB_BINDING');
    const value = z.object({ transaction: z.unknown() }).passthrough().parse(job.result);
    const transaction = z.object({ receiverId: nearAccount, actions: z.array(z.object({ type: z.literal('FunctionCall'), params: z.object({ methodName: z.enum(['authorize', 'record_settlement']), args: z.record(z.string(), z.unknown()), gas: z.string(), deposit: z.string() }).strict() }).strict()).length(1) }).strict().parse(value.transaction);
    const { methodName, args } = transaction.actions[0]!.params;
    operation = operationSchema.parse(methodName === 'authorize' ? { kind: 'authorize', ...args } : { kind: 'settle', ...args });
    const draft: Plan = { format: 'neslos-private-transaction-plan-v1', config, owner: state.config.owner_id, policyVersion: state.config.policy_version, operation };
    if (canonical(plannedCall(draft)) !== canonical(transaction)) throw new Error('TRANSACTION_SUBSTITUTION');
  } else {
    const request = z.object({ kind: z.string() }).passthrough().parse(input);
    if (request.kind === 'fund') input = { ...request, tokenId: state.config.token_id };
    if (request.kind === 'register-token') {
      const registration = z.object({ kind: z.literal('register-token'), account: z.enum(['vault', 'owner']).default('vault') }).strict().parse(input);
      const bounds = await viewNear(state.config.token_id, 'storage_balance_bounds', {}, config.network, state.blockHash);
      input = { kind: registration.kind, tokenId: state.config.token_id, accountId: registration.account === 'vault' ? config.vault : state.config.owner_id, deposit: z.object({ min: z.string() }).parse(bounds.value).min };
    }
    operation = operationSchema.parse(input);
    if (operation.kind === 'authorize' || operation.kind === 'settle') throw new Error('Use a completed private job for runtime transactions.');
    if (operation.kind === 'pin-executor') await attestEndpoint(config.endpoint, config.teePolicy, config.executorPublicKey);
  }
  const plan = transactionPlanSchema.parse({ format: 'neslos-private-transaction-plan-v1', config, owner: state.config.owner_id, policyVersion: state.config.policy_version, operation, intentId: randomUUID() });
  plannedCall(plan);
  return plan;
}
export async function executeTransactionPlan(owner: Awaited<ReturnType<typeof connectOwner>>, input: unknown, approvedHash: string, journalDir: string, allowMainnet = false) {
  const plan = transactionPlanSchema.parse(input), hash = planHash(plan), c = plan.config;
  if (hash !== approvedHash) throw new Error('PLAN_APPROVAL_HASH');
  if (c.network === 'mainnet' && !allowMainnet) throw new Error('MAINNET_OPT_IN_REQUIRED');
  if (owner.network !== c.network || owner.account.accountId !== plan.owner) throw new Error('PLAN_OWNER');
  const call = plannedCall(plan), path = join(journalDir, hash + '.json');
  let exists = false;
  try { await access(path); exists = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  // Once signed, recovery observes the saved hash even if policy/nonce/expiry changed.
  if (!exists) {
    const state = await readVault(c.vault, c.network);
    if (state.config.owner_id !== plan.owner || state.config.policy_version !== plan.policyVersion) throw new Error('PLAN_STATE_CHANGED');
    if ((plan.operation.kind === 'fund' || plan.operation.kind === 'register-token') && plan.operation.tokenId !== state.config.token_id) throw new Error('TOKEN_BINDING');
    if (['authorize', 'settle'].includes(plan.operation.kind) && state.config.executor_public_key !== c.executorPublicKey) throw new Error('EXECUTOR_NOT_PINNED');
    if (plan.operation.kind === 'pin-executor') await attestEndpoint(c.endpoint, c.teePolicy, c.executorPublicKey);
    if (plan.operation.kind === 'authorize' && (state.budget.next_nonce !== plan.operation.authorization.nonce || BigInt(plan.operation.authorization.expires_at_ms) <= BigInt(Date.now()))) throw new Error('AUTHORIZATION_STALE');
  }
  const a = call.actions[0]!.params;
  return submitOnce(owner.account, c.network, path, call.receiverId, [actions.functionCall(a.methodName, a.args, BigInt(a.gas), BigInt(a.deposit))]);
}
