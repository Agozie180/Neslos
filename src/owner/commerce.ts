import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { actions } from 'near-api-js';
import { z } from 'zod';
import { AgentMarketClient, agentQuoteHash, agentQuoteSchema, agentTaskSummary, type AgentQuote } from '../core/agent-market.js';
import { units } from '../core/amounts.js';
import { canonical, sha256 } from '../core/crypto.js';
import { lendingCall, lendingPlanSchema, lendingPosition, observeLendingChange, readLendingPosition, RHEA_CONTRACTS, type LendingPlan } from '../core/lending.js';
import { readVault, retryNearRead, viewNear } from '../core/near.js';
import { NATIVE_USDC } from '../core/research.js';
import { nearAccount } from '../core/wire.js';
import { assertCommerceState, commerceRequestSchema, vaultCommerceCall, type CommerceRequest, type CommerceVaultState } from '../core/vault-commerce.js';
import { submitOnce, transactionOutcome, verifyTransactionOutcome, type connectOwner } from './account.js';
import { CommerceBudget, type VaultCommercePolicy } from './commerce-budget.js';
import { fetchPaymentTransaction, verifyAgentSettlement, verifyLendingTransaction, verifyVaultCommerceTransaction } from '../core/commerce-settlement.js';

type Owner = Awaited<ReturnType<typeof connectOwner>>;
const atomic = z.string().refine(v => { try { units(v); return true; } catch { return false; } });
const callSchema = z.object({ receiverId: nearAccount, methodName: z.string(), args: z.record(z.string(), z.unknown()), gas: atomic, deposit: atomic }).strict();
const legacyPlanSchema = z.object({
  format: z.literal('neslos-commerce-plan-v1'), id: z.string().uuid(), account: nearAccount,
  operation: z.discriminatedUnion('kind', [z.object({ kind: z.literal('lending'), plan: lendingPlanSchema }).strict(), z.object({ kind: z.literal('storage'), contract: nearAccount, deposit: atomic }).strict()]),
  nativeReservation: atomic, createdAt: z.iso.datetime(),
}).strict();
export const vaultCommercePlanSchema = z.object({
  format: z.literal('neslos-commerce-plan-v2'), id: z.string().uuid(), network: z.enum(['mainnet', 'testnet']), account: nearAccount, vault: nearAccount, token: nearAccount,
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lending'), plan: lendingPlanSchema, request: commerceRequestSchema }).strict(),
    z.object({ kind: z.literal('payment'), request: commerceRequestSchema }).strict(),
    z.object({ kind: z.literal('storage'), contract: nearAccount, deposit: atomic }).strict(),
  ]), nativeReservation: atomic, createdAt: z.iso.datetime(),
}).strict();
export const commercePlanSchema = z.discriminatedUnion('format', [legacyPlanSchema, vaultCommercePlanSchema]);
export type CommercePlan = z.infer<typeof commercePlanSchema>;
export type VaultCommercePlan = z.infer<typeof vaultCommercePlanSchema>;
export const commercePlanHash = (plan: CommercePlan) => sha256(canonical(commercePlanSchema.parse(plan)));
const GAS_RESERVE = 100_000_000_000_000_000_000_000n; // local native-cost reserve, not principal authority

export function requireVaultCommerce(budget: CommerceBudget): VaultCommercePolicy {
  if (budget.policy.format !== 'neslos-commerce-policy-v2') throw new Error('COMMERCE_VAULT_CONFIG_REQUIRED: v1 is recovery-only; configure a vault with v2.');
  return budget.policy;
}
/** New principal calls target the vault. Storage registers the vault and spends only owner NEAR. */
export function commerceCall(input: CommercePlan) {
  const plan = commercePlanSchema.parse(input);
  if (plan.format !== 'neslos-commerce-plan-v2') throw new Error('COMMERCE_LEGACY_PLAN_DISABLED');
  const op = plan.operation;
  if (op.kind === 'storage') {
    if (![plan.token, RHEA_CONTRACTS[plan.network]].includes(op.contract) || units(op.deposit) === 0n || units(op.deposit) > 10n ** 24n) throw new Error('COMMERCE_STORAGE_BINDING');
    return { receiverId: op.contract, methodName: 'storage_deposit', args: { account_id: plan.vault, registration_only: true }, gas: '30000000000000', deposit: op.deposit };
  }
  const r = op.request;
  if (r.vault !== plan.vault || r.network !== plan.network) throw new Error('COMMERCE_PLAN_BINDING');
  if (op.kind === 'payment' && r.action !== 0) throw new Error('COMMERCE_PAYMENT_BINDING');
  if (op.kind === 'payment' && r.venue === 'near-agent-market') throw new Error('AGENT_VAULT_PAYMENT_UNSUPPORTED');
  if (op.kind === 'lending') {
    const p = op.plan, s = p.snapshot;
    if (s.account !== plan.vault || s.network !== plan.network || s.token !== plan.token || p.requestId !== plan.id || p.amount !== r.amount || r.action !== (p.operation === 'supply' ? 1 : 2) || r.target !== s.contract) throw new Error('COMMERCE_LENDING_BINDING');
    lendingCall(p, Date.parse(s.fetchedAt));
    if (lendingPosition(s).hasDebt) throw new Error('LENDING_DEBT_REQUIRES_SEPARATE_REVIEW');
  }
  return vaultCommerceCall(r);
}
async function vaultState(budget: CommerceBudget) {
  const p = requireVaultCommerce(budget), state = await readVault(p.vault, p.network);
  if (state.config.owner_id !== p.account) throw new Error('COMMERCE_OWNER_BINDING');
  return { p, state };
}
function requestFor(p: VaultCommercePolicy, state: CommerceVaultState, action: CommerceRequest['action'], amount: string, target: string, venue: string, id: string): CommerceRequest {
  const openings = p.openings.filter(row => row.venue === venue && row.target === target);
  if (openings.length !== 1) throw new Error('COMMERCE_OPENING_REQUIRED');
  const opening = openings[0]!, now = Date.now(), ttl = Math.min(60_000, Number(state.config.policy.max_quote_age_ms));
  const quoteHash = sha256(canonical({ domain: 'neslos:public-commerce-terms:v1', id, action, amount, target, venue, blockHash: state.blockHash }));
  const request = commerceRequestSchema.parse({ domain: 'neslos:commerce:v1', network: p.network, vault: p.vault,
    policy_version: state.config.policy_version, nonce: state.budget.next_nonce, action, amount, target, venue,
    venue_salt: opening.venueSalt, counterparty_salt: opening.counterpartySalt, quoted_at_ms: String(now), expires_at_ms: String(now + ttl),
    quote_hash: quoteHash, audit_hash: sha256(canonical({ domain: 'neslos:public-commerce-audit:v1', id, owner: p.account, quoteHash })) });
  assertCommerceState(request, state, p.account, state.config.token_id, now);
  return request;
}
function finishPlan(p: VaultCommercePolicy, state: CommerceVaultState, id: string, operation: VaultCommercePlan['operation']) {
  const draft = { format: 'neslos-commerce-plan-v2' as const, id, network: p.network, account: p.account, vault: p.vault, token: state.config.token_id, operation, nativeReservation: '0', createdAt: new Date().toISOString() };
  return vaultCommercePlanSchema.parse({ ...draft, nativeReservation: (GAS_RESERVE + units(commerceCall(draft).deposit)).toString() });
}
export async function planLending(budget: CommerceBudget, operation: 'supply' | 'withdraw', amount: string): Promise<VaultCommercePlan> {
  if (!budget.policy.allowPublicLending) throw new Error('PUBLIC_LENDING_DISABLED');
  const { p, state } = await vaultState(budget);
  if (state.config.policy.require_confidential) throw new Error('COMMERCE_PRIVATE_POLICY');
  const snapshot = await readLendingPosition(p.vault, state.config.token_id, p.network), id = randomUUID();
  const plan: LendingPlan = { format: 'neslos-rhea-plan-v1', operation, snapshot, amount, maximumAmount: state.config.policy.per_action_limit, requestId: id, allowPublicPosition: true };
  return finishPlan(p, state, id, { kind: 'lending', plan, request: requestFor(p, state, operation === 'supply' ? 1 : 2, amount, snapshot.contract, 'rhea', id) });
}
/** A public exact token payment; this is not an Agent Market x402 payment. */
export async function planVaultPayment(budget: CommerceBudget, amount: string, target: string, venue: string): Promise<VaultCommercePlan> {
  if (venue === 'near-agent-market') throw new Error('AGENT_VAULT_PAYMENT_UNSUPPORTED');
  const { p, state } = await vaultState(budget), id = randomUUID();
  return finishPlan(p, state, id, { kind: 'payment', request: requestFor(p, state, 0, amount, target, venue, id) });
}
export async function planCommerceStorage(budget: CommerceBudget, contract: string): Promise<VaultCommercePlan | { registered: true }> {
  const { p, state } = await vaultState(budget);
  if (![state.config.token_id, RHEA_CONTRACTS[p.network]].includes(contract)) throw new Error('COMMERCE_STORAGE_BINDING');
  const balance = await viewNear(contract, 'storage_balance_of', { account_id: p.vault }, p.network);
  if (balance.value !== null) { z.object({ total: atomic, available: atomic }).parse(balance.value); return { registered: true }; }
  const bounds = await viewNear(contract, 'storage_balance_bounds', {}, p.network, balance.blockHash);
  return finishPlan(p, state, randomUUID(), { kind: 'storage', contract, deposit: z.object({ min: atomic }).parse(bounds.value).min });
}
function checkOwner(owner: Owner, budget: CommerceBudget) {
  if (owner.network !== budget.policy.network || owner.account.accountId !== budget.policy.account) throw new Error('COMMERCE_OWNER_BINDING');
}
function checkAge(date: string) { const age = Date.now() - Date.parse(date); if (age < 0 || age > 60000) throw new Error('COMMERCE_PLAN_STALE'); }
export async function executeCommercePlan(owner: Owner, budget: CommerceBudget, input: CommercePlan, approvedHash: string, journalDir: string) {
  checkOwner(owner, budget);
  const p = requireVaultCommerce(budget), plan = vaultCommercePlanSchema.parse(input);
  if (commercePlanHash(plan) !== approvedHash || plan.account !== p.account || plan.vault !== p.vault || plan.network !== p.network) throw new Error('COMMERCE_PLAN_BINDING');
  const call = commerceCall(plan), op = plan.operation;
  if (units(plan.nativeReservation) !== GAS_RESERVE + units(call.deposit)) throw new Error('COMMERCE_NATIVE_RESERVATION');
  if (op.kind === 'lending' && !p.allowPublicLending) throw new Error('PUBLIC_LENDING_DISABLED');
  const kind = op.kind === 'storage' ? 'storage' : op.kind === 'payment' ? 'vault-payment' : op.plan.operation === 'supply' ? 'lending-supply' : 'lending-withdraw';
  return budget.once({ id: plan.id, kind, amount: op.kind === 'storage' ? '0' : op.request.amount, nativeAmount: plan.nativeReservation, input: plan }, async () => {
    checkAge(plan.createdAt);
    const state = await readVault(plan.vault, plan.network);
    if (state.config.owner_id !== plan.account || state.config.token_id !== plan.token) throw new Error('COMMERCE_VAULT_BINDING');
    if (op.kind !== 'storage') assertCommerceState(op.request, state, plan.account, plan.token);
    const block = await retryNearRead(() => owner.provider.viewBlock({ finality: 'final' }));
    if (BigInt(block.header.gas_price) > 200_000_000n) throw new Error('COMMERCE_GAS_PRICE_CHANGED');
    if (op.kind === 'lending') {
      const refreshed = await readLendingPosition(plan.vault, plan.token, plan.network);
      if (canonical(lendingCall(op.plan)) !== canonical(lendingCall({ ...op.plan, snapshot: refreshed }))) throw new Error('COMMERCE_PROTOCOL_CHANGED');
      if (lendingPosition(refreshed).hasDebt) throw new Error('LENDING_DEBT_REQUIRES_SEPARATE_REVIEW');
      for (const contract of [plan.token, RHEA_CONTRACTS[plan.network]]) {
        const registration = await viewNear(contract, 'storage_balance_of', { account_id: plan.vault }, plan.network);
        if (registration.value === null) throw new Error('COMMERCE_STORAGE_REQUIRED');
      }
      return { plan, call, before: refreshed };
    }
    if (op.kind === 'storage') {
      const bounds = await viewNear(op.contract, 'storage_balance_bounds', {}, plan.network);
      if (z.object({ min: atomic }).parse(bounds.value).min !== op.deposit) throw new Error('COMMERCE_STORAGE_PRICE_CHANGED');
    }
    return { plan, call };
  }, async () => {
    const a = callSchema.parse(call);
    const transaction = await submitOnce(owner.account, plan.network, join(journalDir, plan.id + '.json'), a.receiverId, [actions.functionCall(a.methodName, a.args, BigInt(a.gas), BigInt(a.deposit))]);
    return { transaction, ...transactionOutcome(transaction.outcome), settlementVerified: false };
  });
}
/** Recovery observes the original hash, including historical v1 operations. It never signs. */
export async function observeCommerceTransaction(owner: Owner, budget: CommerceBudget, id: string, journalDir: string) {
  checkOwner(owner, budget);
  const { readFile } = await import('node:fs/promises');
  return budget.observe(id, async entry => {
    if (entry.kind === 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const preparation = z.object({ plan: commercePlanSchema, call: callSchema, before: lendingPlanSchema.shape.snapshot.optional() }).parse(entry.preparation);
    const plan = preparation.plan;
    if (entry.inputHash !== commercePlanHash(plan) || plan.id !== id || plan.account !== owner.account.accountId) throw new Error('COMMERCE_OBSERVATION_BINDING');
    const modern = plan.format === 'neslos-commerce-plan-v2';
    if (modern && (plan.vault !== requireVaultCommerce(budget).vault || plan.network !== owner.network || canonical(commerceCall(plan)) !== canonical(preparation.call))) throw new Error('COMMERCE_OBSERVATION_BINDING');
    if (!modern && budget.policy.format !== 'neslos-commerce-policy-v1') throw new Error('COMMERCE_OBSERVATION_BINDING');
    const record = z.object({ hash: z.string(), signer: nearAccount, receiver: nearAccount, fingerprint: z.string() }).parse(JSON.parse(await readFile(join(journalDir, id + '.json'), 'utf8')));
    if (record.signer !== plan.account || record.receiver !== preparation.call.receiverId) throw new Error('COMMERCE_OBSERVATION_BINDING');
    const outcome = await retryNearRead(() => owner.provider.viewTransactionStatus({ txHash: record.hash, accountId: record.signer, waitUntil: 'FINAL' }));
    verifyTransactionOutcome(outcome, record);
    const status = transactionOutcome(outcome), op = plan.operation;
    if (!status.final) throw new Error('COMMERCE_TRANSACTION_PENDING');
    const account = modern ? plan.vault : record.signer, token = modern ? plan.token : NATIVE_USDC, network = modern ? plan.network : 'mainnet';
    if (op.kind === 'storage') {
      const registration = await viewNear(op.contract, 'storage_balance_of', { account_id: account }, network);
      return { transactionHash: record.hash, ...status, registered: status.success && registration.value !== null };
    }
    let verified = false;
    if (status.success) {
      if (modern) verified = verifyVaultCommerceTransaction(outcome, { hash: record.hash, owner: plan.account, vault: plan.vault, token: plan.token, call: preparation.call, request: (op as Exclude<VaultCommercePlan['operation'], { kind: 'storage' }>).request });
      else if (op.kind === 'lending') verified = verifyLendingTransaction(outcome, { hash: record.hash, sender: record.signer, call: preparation.call, operation: op.plan.operation, protocol: RHEA_CONTRACTS.mainnet, amount: op.plan.amount });
    }
    if (op.kind === 'payment') return { transactionHash: record.hash, ...status, settlementVerified: verified, sender: account, token };
    if (!preparation.before) throw new Error('COMMERCE_POSITION_BASELINE_MISSING');
    const after = await readLendingPosition(account, token, network), change = observeLendingChange(preparation.before, after, op.plan.operation);
    return { transactionHash: record.hash, ...status, position: lendingPosition(after), change, settlementVerified: verified && change.observed };
  });
}
/** Market only supports owner-wallet delegated ft_transfer, which bypasses the vault. */
export async function payAgentJob(_owner: Owner, _budget: CommerceBudget, _quote: AgentQuote, _approvedHash: string, _market = new AgentMarketClient()): Promise<never> {
  throw new Error('AGENT_VAULT_PAYMENT_UNSUPPORTED: the marketplace requires an owner-wallet delegated ft_transfer; no vault payment rail is supported.');
}
/** Historical recovery remains available without creating authorizations. */
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
  if (budget.policy.format !== 'neslos-commerce-policy-v1') throw new Error('AGENT_VAULT_PAYMENT_UNSUPPORTED');
  return budget.observe(id, async entry => {
    if (entry.kind !== 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const { quote, proof } = z.object({ quote: agentQuoteSchema, proof: z.unknown() }).parse(entry.preparation);
    if (entry.inputHash !== agentQuoteHash(quote) || quote.request.messageId !== id) throw new Error('AGENT_OBSERVATION_BINDING');
    const settlement = verifyAgentSettlement(await fetchPaymentTransaction(hash, relayer), { hash, relayer, delegate: proof, sender: budget.policy.account, payee: quote.requirement.payTo, amount: quote.requirement.amount });
    return { ...(entry.observation as object | undefined), ...settlement };
  });
}
export async function observeAgentExpiry(owner: Owner, budget: CommerceBudget, id: string) {
  checkOwner(owner, budget);
  if (budget.policy.format !== 'neslos-commerce-policy-v1') throw new Error('AGENT_VAULT_PAYMENT_UNSUPPORTED');
  return budget.observe(id, async entry => {
    if (entry.kind !== 'agent-job') throw new Error('COMMERCE_OBSERVATION_KIND');
    const prepared = z.object({ quote: agentQuoteSchema, proof: z.object({ delegate_action: z.object({ max_block_height: atomic, sender_id: nearAccount }) }) }).parse(entry.preparation);
    if (agentQuoteHash(prepared.quote) !== entry.inputHash || prepared.proof.delegate_action.sender_id !== budget.policy.account) throw new Error('AGENT_OBSERVATION_BINDING');
    const block = await retryNearRead(() => owner.provider.viewBlock({ finality: 'final' }));
    if (BigInt(block.header.height) <= units(prepared.proof.delegate_action.max_block_height)) throw new Error('AGENT_AUTHORIZATION_STILL_LIVE');
    return { ...(entry.observation as object | undefined), authorizationExpired: true, expiryBlock: block.header.height };
  });
}
