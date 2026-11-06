import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { actions, baseEncode, encodeSignedDelegate, type SignedDelegate } from 'near-api-js';
import { z } from 'zod';
import { AgentMarketClient, agentQuoteHash, agentQuoteSchema, agentTaskSummary, type AgentQuote } from '../core/agent-market.js';
import { units } from '../core/amounts.js';
import { canonical, sha256 } from '../core/crypto.js';
import { lendingCall, lendingPlanSchema, lendingPosition, observeLendingChange, readLendingPosition, RHEA_CONTRACTS, type LendingPlan } from '../core/lending.js';
import { retryNearRead, viewNear } from '../core/near.js';
import { NATIVE_USDC } from '../core/research.js';
import { nearAccount } from '../core/wire.js';
import { submitOnce, transactionOutcome, verifyTransactionOutcome, type connectOwner } from './account.js';
import { CommerceBudget } from './commerce-budget.js';
import { fetchPaymentTransaction, verifyAgentSettlement, verifyLendingTransaction } from '../core/commerce-settlement.js';

type Owner = Awaited<ReturnType<typeof connectOwner>>;
const atomic = z.string().refine(v => { try { units(v); return true; } catch { return false; } });
const callSchema = z.object({ receiverId: nearAccount, methodName: z.string(), args: z.record(z.string(), z.unknown()), gas: atomic, deposit: atomic }).strict();
export const commercePlanSchema = z.object({
  format: z.literal('neslos-commerce-plan-v1'), id: z.string().uuid(), account: nearAccount,
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lending'), plan: lendingPlanSchema }).strict(),
    z.object({ kind: z.literal('storage'), contract: nearAccount, deposit: atomic }).strict(),
  ]), nativeReservation: atomic, createdAt: z.iso.datetime(),
}).strict();
export type CommercePlan = z.infer<typeof commercePlanSchema>;
export const commercePlanHash = (plan: CommercePlan) => sha256(canonical(commercePlanSchema.parse(plan)));
// A conservative local reservation, not a protocol-enforced gas cap. Check the gas price again before signing.
const GAS_RESERVE = 100_000_000_000_000_000_000_000n; // 0.1 NEAR per direct transaction

export function commerceCall(plan: CommercePlan) {
  commercePlanSchema.parse(plan);
  if (plan.operation.kind === 'lending') {
    if (plan.account !== plan.operation.plan.snapshot.account || plan.operation.plan.snapshot.network !== 'mainnet' || plan.operation.plan.snapshot.token !== NATIVE_USDC) throw new Error('COMMERCE_LENDING_BINDING');
    // Construction is deterministic for journal recovery. Freshness is checked before new signing.
    return lendingCall(plan.operation.plan, Date.parse(plan.operation.plan.snapshot.fetchedAt));
  }
  const op = plan.operation;
  if (![NATIVE_USDC, RHEA_CONTRACTS.mainnet].includes(op.contract) || units(op.deposit) === 0n || units(op.deposit) > 10n ** 24n) throw new Error('COMMERCE_STORAGE_BINDING');
  return { receiverId: op.contract, methodName: 'storage_deposit', args: { account_id: plan.account, registration_only: true }, gas: '30000000000000', deposit: op.deposit };
}

export async function planLending(budget: CommerceBudget, operation: 'supply' | 'withdraw', amount: string): Promise<CommercePlan> {
  if (!budget.policy.allowPublicLending) throw new Error('PUBLIC_LENDING_DISABLED');
  const snapshot = await readLendingPosition(budget.policy.account, NATIVE_USDC, 'mainnet');
  const plan: LendingPlan = { format: 'neslos-rhea-plan-v1', operation, snapshot, amount, maximumAmount: operation === 'supply' ? budget.policy.perActionLimitAtomic : amount, requestId: randomUUID(), allowPublicPosition: true };
  const call = lendingCall(plan);
  return commercePlanSchema.parse({ format: 'neslos-commerce-plan-v1', id: plan.requestId, account: snapshot.account, operation: { kind: 'lending', plan }, nativeReservation: (GAS_RESERVE + units(call.deposit)).toString(), createdAt: new Date().toISOString() });
}

export async function planCommerceStorage(budget: CommerceBudget, contract: string): Promise<CommercePlan | { registered: true }> {
  if (![NATIVE_USDC, RHEA_CONTRACTS.mainnet].includes(contract)) throw new Error('COMMERCE_STORAGE_BINDING');
  const balance = await viewNear(contract, 'storage_balance_of', { account_id: budget.policy.account }, 'mainnet');
  if (balance.value !== null) { z.object({ total: atomic, available: atomic }).parse(balance.value); return { registered: true }; }
  const bounds = await viewNear(contract, 'storage_balance_bounds', {}, 'mainnet', balance.blockHash);
  const deposit = z.object({ min: atomic }).parse(bounds.value).min;
  const plan = commercePlanSchema.parse({ format: 'neslos-commerce-plan-v1', id: randomUUID(), account: budget.policy.account, operation: { kind: 'storage', contract, deposit }, nativeReservation: (GAS_RESERVE + units(deposit)).toString(), createdAt: new Date().toISOString() });
  commerceCall(plan); return plan;
}

function checkOwner(owner: Owner, budget: CommerceBudget) {
  if (owner.network !== 'mainnet' || owner.account.accountId !== budget.policy.account) throw new Error('COMMERCE_OWNER_BINDING');
}
function checkAge(date: string, max = 60000) { const age = Date.now() - Date.parse(date); if (age < -5000 || age > max) throw new Error('COMMERCE_PLAN_STALE'); }

export async function executeCommercePlan(owner: Owner, budget: CommerceBudget, plan: CommercePlan, approvedHash: string, journalDir: string) {
  checkOwner(owner, budget);
  if (commercePlanHash(plan) !== approvedHash || plan.account !== budget.policy.account) throw new Error('COMMERCE_PLAN_BINDING');
  const call = commerceCall(plan), op = plan.operation;
  if (units(plan.nativeReservation) !== GAS_RESERVE + units(call.deposit)) throw new Error('COMMERCE_NATIVE_RESERVATION');
  if (op.kind === 'lending' && !budget.policy.allowPublicLending) throw new Error('PUBLIC_LENDING_DISABLED');
  const kind = op.kind === 'storage' ? 'storage' : op.plan.operation === 'supply' ? 'lending-supply' : 'lending-withdraw';
  return budget.once({ id: plan.id, kind, amount: kind === 'lending-supply' && op.kind === 'lending' ? op.plan.amount : '0', nativeAmount: plan.nativeReservation, input: plan }, async () => {
    checkAge(plan.createdAt);
    const block = await retryNearRead(() => owner.provider.viewBlock({ finality: 'final' }));
    if (BigInt(block.header.gas_price) > 200_000_000n) throw new Error('COMMERCE_GAS_PRICE_CHANGED');
    if (op.kind === 'lending') {
      const refreshed = await readLendingPosition(plan.account, NATIVE_USDC, 'mainnet');
      const freshCall = lendingCall({ ...op.plan, snapshot: refreshed });
      if (canonical(call) !== canonical(freshCall)) throw new Error('COMMERCE_PROTOCOL_CHANGED');
      for (const contract of [NATIVE_USDC, RHEA_CONTRACTS.mainnet]) {
        const registration = await viewNear(contract, 'storage_balance_of', { account_id: plan.account }, 'mainnet');
        if (registration.value === null) throw new Error('COMMERCE_STORAGE_REQUIRED');
      }
      return { plan, call, before: refreshed };
    }
    const bounds = await viewNear(op.contract, 'storage_balance_bounds', {}, 'mainnet');
    if (z.object({ min: atomic }).parse(bounds.value).min !== op.deposit) throw new Error('COMMERCE_STORAGE_PRICE_CHANGED');
    return { plan, call };
  }, async () => {
    const a = callSchema.parse(call);
    const transaction = await submitOnce(owner.account, 'mainnet', join(journalDir, plan.id + '.json'), a.receiverId, [actions.functionCall(a.methodName, a.args, BigInt(a.gas), BigInt(a.deposit))]);
    return { transaction, ...transactionOutcome(transaction.outcome), settlementVerified: false };
  });
}

/** Recovery uses the original hash. It never calls submit or signs a replacement. */
export async function observeCommerceTransaction(owner: Owner, budget: CommerceBudget, id: string, journalDir: string) {
  checkOwner(owner, budget);
  const { readFile } = await import('node:fs/promises');
  return budget.observe(id, async entry => {
    if (entry.kind === 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const preparation = z.object({ plan: commercePlanSchema, call: callSchema, before: lendingPlanSchema.shape.snapshot.optional() }).parse(entry.preparation);
    if (entry.inputHash !== commercePlanHash(preparation.plan) || preparation.plan.id !== id || preparation.plan.account !== owner.account.accountId) throw new Error('COMMERCE_OBSERVATION_BINDING');
    const record = z.object({ hash: z.string(), signer: nearAccount, receiver: nearAccount, fingerprint: z.string() }).parse(JSON.parse(await readFile(join(journalDir, id + '.json'), 'utf8')));
    if (record.signer !== owner.account.accountId || record.receiver !== preparation.call.receiverId) throw new Error('COMMERCE_OBSERVATION_BINDING');
    const outcome = await retryNearRead(() => owner.provider.viewTransactionStatus({ txHash: record.hash, accountId: record.signer, waitUntil: 'FINAL' }));
    verifyTransactionOutcome(outcome, record);
    const status = transactionOutcome(outcome);
    if (!status.final) throw new Error('COMMERCE_TRANSACTION_PENDING');
    const op = preparation.plan.operation;
    if (op.kind === 'storage') {
      const registration = await viewNear(op.contract, 'storage_balance_of', { account_id: record.signer }, 'mainnet');
      return { transactionHash: record.hash, ...status, registered: status.success && registration.value !== null };
    }
    if (!preparation.before) throw new Error('COMMERCE_POSITION_BASELINE_MISSING');
    if (status.success) verifyLendingTransaction(outcome, { hash: record.hash, sender: record.signer, call: preparation.call, operation: op.plan.operation, protocol: RHEA_CONTRACTS.mainnet, amount: op.plan.amount });
    const after = await readLendingPosition(record.signer, NATIVE_USDC, 'mainnet');
    const change = observeLendingChange(preparation.before, after, op.plan.operation);
    return { transactionHash: record.hash, ...status, position: lendingPosition(after), change, settlementVerified: status.success && change.observed };
  });
}

export function agentPaymentCall(quote: AgentQuote) {
  const q = agentQuoteSchema.parse(quote);
  if (units(q.requirement.amount) > units(q.maximumAmount)) throw new Error('AGENT_PRICE_EXCEEDS_LIMIT');
  return actions.functionCall('ft_transfer', { receiver_id: q.requirement.payTo, amount: q.requirement.amount }, 30_000_000_000_000n, 1n);
}

/** Exact RPC representation retained for matching a relayer's finalized transaction. */
export function delegateProof(signed: SignedDelegate) {
  const d = signed.delegateAction;
  if (d.actions.length !== 1 || !d.actions[0]?.functionCall) throw new Error('AGENT_DELEGATE_ACTION');
  const a = d.actions[0].functionCall;
  return { delegate_action: { sender_id: d.senderId, receiver_id: d.receiverId, actions: [{ FunctionCall: { method_name: a.methodName, args: Buffer.from(a.args).toString('base64'), gas: a.gas.toString(), deposit: a.deposit.toString() } }], nonce: d.nonce.toString(), max_block_height: d.maxBlockHeight.toString(), public_key: d.publicKey.toString() }, signature: 'ed25519:' + baseEncode(signed.signature.data) };
}

export async function payAgentJob(owner: Owner, budget: CommerceBudget, quote: AgentQuote, approvedHash: string, market = new AgentMarketClient()) {
  checkOwner(owner, budget);
  if (agentQuoteHash(quote) !== approvedHash || !budget.policy.allowedAgentHandles.includes(quote.request.handle)) throw new Error('AGENT_APPROVAL_BINDING');
  const action = agentPaymentCall(quote);
  return budget.once({ id: quote.request.messageId, kind: 'agent-job', amount: quote.requirement.amount, nativeAmount: '1', input: quote }, async () => {
    checkAge(quote.quotedAt);
    const balance = await viewNear(NATIVE_USDC, 'ft_balance_of', { account_id: owner.account.accountId }, 'mainnet');
    if (units(z.string().parse(balance.value)) < units(quote.requirement.amount)) throw new Error('AGENT_INSUFFICIENT_USDC');
    // This is an explicit block allowance, not a conversion from seconds.
    // Early expiry is preferable to extending a short quote's authorization.
    const blockHeightTtl = Math.min(4200, quote.requirement.maxTimeoutSeconds);
    const { signedDelegate } = await owner.account.createSignedMetaTransaction({ receiverId: NATIVE_USDC, actions: [action], blockHeightTtl });
    const proof = delegateProof(signedDelegate);
    if (proof.delegate_action.sender_id !== owner.account.accountId || proof.delegate_action.receiver_id !== NATIVE_USDC) throw new Error('AGENT_SIGNER_BINDING');
    const payment = Buffer.from(JSON.stringify({ x402Version: 2, accepted: quote.requirement, payload: { signedDelegateAction: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') } })).toString('base64');
    return { quote, payment, proof };
  }, async prepared => {
    const { payment } = z.object({ payment: z.string() }).parse(prepared);
    const dispatch = await market.dispatch(quote, payment);
    return { dispatch, summary: agentTaskSummary(dispatch.task), settlementVerified: false };
  });
}

export async function observeAgentJob(budget: CommerceBudget, id: string, market = new AgentMarketClient()) {
  return budget.observe(id, async entry => {
    if (entry.kind !== 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const { quote } = z.object({ quote: agentQuoteSchema }).parse(entry.preparation);
    if (entry.inputHash !== agentQuoteHash(quote) || quote.request.messageId !== id) throw new Error('AGENT_OBSERVATION_BINDING');
    const previous = z.object({ dispatch: z.object({ task: z.object({ id: z.string() }) }) }).passthrough().parse(entry.result);
    const dispatch = await market.task(quote.request.handle, previous.dispatch.task.id);
    return { ...previous, ...(entry.observation as object | undefined), dispatch, summary: agentTaskSummary(dispatch.task) };
  });
}

export async function settleAgentJob(budget: CommerceBudget, id: string, hash: string, relayer: string) {
  return budget.observe(id, async entry => {
    if (entry.kind !== 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const { quote, proof } = z.object({ quote: agentQuoteSchema, proof: z.unknown() }).parse(entry.preparation);
    if (entry.inputHash !== agentQuoteHash(quote) || quote.request.messageId !== id) throw new Error('AGENT_OBSERVATION_BINDING');
    const settlement = verifyAgentSettlement(await fetchPaymentTransaction(hash, relayer), { hash, relayer, delegate: proof, sender: budget.policy.account, payee: quote.requirement.payTo, amount: quote.requirement.amount });
    return { ...(entry.observation as object | undefined), ...settlement };
  });
}

/** Expiry permits new nonces; it does not assert payment failure or replenish the cap. */
export async function observeAgentExpiry(owner: Owner, budget: CommerceBudget, id: string) {
  checkOwner(owner, budget);
  return budget.observe(id, async entry => {
    if (entry.kind !== 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const prepared = z.object({ quote: agentQuoteSchema, proof: z.object({ delegate_action: z.object({ max_block_height: atomic, sender_id: nearAccount }) }) }).parse(entry.preparation);
    if (agentQuoteHash(prepared.quote) !== entry.inputHash || prepared.proof.delegate_action.sender_id !== budget.policy.account) throw new Error('AGENT_OBSERVATION_BINDING');
    const block = await retryNearRead(() => owner.provider.viewBlock({ finality: 'final' }));
    if (BigInt(block.header.height) <= units(prepared.proof.delegate_action.max_block_height)) throw new Error('AGENT_AUTHORIZATION_STILL_LIVE');
    return { ...(entry.observation as object | undefined), authorizationExpired: true, expiryBlock: block.header.height };
  });
}
