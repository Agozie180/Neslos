import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AgentMarketClient, agentRequestSchema } from '../src/core/agent-market.js';
import { readLendingPosition, lendingPosition, RHEA_CONTRACTS } from '../src/core/lending.js';
import { readVault } from '../src/core/near.js';
import { connectOwner, json, writePrivateJson } from '../src/owner/account.js';
import { CommerceBudget, commercePolicySchema } from '../src/owner/commerce-budget.js';
import { commerceCall, commercePlanHash, commercePlanSchema, executeCommercePlan, observeAgentExpiry, observeAgentJob, observeCommerceTransaction, planCommerceStorage, planLending, planVaultPayment, requireVaultCommerce, settleAgentJob } from '../src/owner/commerce.js';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
  policy: { type: 'string', default: '.private/commerce/policy.json' },
  directory: { type: 'string', default: '.private/commerce' }, credentials: { type: 'string' },
  request: { type: 'string' }, plan: { type: 'string' }, out: { type: 'string' }, amount: { type: 'string' },
  'maximum-amount': { type: 'string' }, 'approve-hash': { type: 'string' }, 'allow-mainnet': { type: 'boolean', default: false },
  operation: { type: 'string' }, contract: { type: 'string' }, id: { type: 'string' }, hash: { type: 'string' }, relayer: { type: 'string' },
  target: { type: 'string' }, venue: { type: 'string' },
} });
const required = (name: keyof typeof v) => { const value = v[name]; if (typeof value !== 'string' || !value) throw new Error('Required option: --' + name); return value; };
const read = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8'));
const budget = async () => new CommerceBudget(v.directory, commercePolicySchema.parse(await read(v.policy)));
const owner = async (b: CommerceBudget) => { if (b.policy.network === 'mainnet' && !v['allow-mainnet']) throw new Error('MAINNET_OPT_IN_REQUIRED'); return connectOwner(b.policy.network, required('credentials')); };
const save = async (value: unknown, exclusive = true) => { const out = required('out'); await writePrivateJson(out, value, exclusive); return resolve(out); };

async function main() {
  const command = positionals[0];
  if (command === 'status') {
    const b = await budget(), local = await b.status();
    const chain = b.policy.format === 'neslos-commerce-policy-v2' ? await readVault(b.policy.vault, b.policy.network) : null;
    console.log(json({ localJournal: local, principalAuthority: chain ? 'on-chain vault policy' : 'legacy recovery only', ...(chain ? { vault: requireVaultCommerce(b).vault, token: chain.config.token_id, policy: chain.config.policy, budget: chain.budget, balance: chain.balance, blockHash: chain.blockHash } : {}) })); return;
  }
  if (command === 'position') {
    const b = await budget(), p = requireVaultCommerce(b), state = await readVault(p.vault, p.network), snapshot = await readLendingPosition(p.vault, state.config.token_id, p.network);
    if (v.out) await save(snapshot);
    console.log(json({ account: p.vault, ...lendingPosition(snapshot), blockHash: snapshot.blockHash, blockHeight: snapshot.blockHeight })); return;
  }
  if (command === 'plan-lending' || command === 'plan-storage' || command === 'plan-payment') {
    const b = await budget(), p = requireVaultCommerce(b);
    const token = command === 'plan-storage' && ['token', 'usdc'].includes(v.contract ?? '') ? (await readVault(p.vault, p.network)).config.token_id : undefined;
    const plan = command === 'plan-lending'
      ? await planLending(b, z.enum(['supply', 'withdraw']).parse(required('operation')), required('amount'))
      : command === 'plan-payment' ? await planVaultPayment(b, required('amount'), required('target'), required('venue'))
      : await planCommerceStorage(b, v.contract === 'rhea' ? RHEA_CONTRACTS[p.network] : token ?? required('contract'));
    if ('registered' in plan) { console.log(json(plan)); return; }
    const saved = await save(plan);
    console.log(json({ saved, approveHash: commercePlanHash(plan), call: commerceCall(plan), reservedNativeYocto: plan.nativeReservation })); return;
  }
  if (command === 'submit') {
    const plan = commercePlanSchema.parse(await read(required('plan')));
    if (commercePlanHash(plan) !== required('approve-hash')) throw new Error('COMMERCE_PLAN_BINDING');
    const b = await budget(), result = await executeCommercePlan(await owner(b), b, plan, required('approve-hash'), join(v.directory, 'transactions'));
    console.log(json({ id: plan.id, final: result.final, transactionSuccess: result.success, settlementVerified: false, hash: result.transaction.hash, note: 'Use observe-transaction to verify vault token settlement and any lending position.' })); return;
  }
  if (command === 'observe-transaction') {
    const b = await budget(), result = await observeCommerceTransaction(await owner(b), b, required('id'), join(v.directory, 'transactions'));
    const saved = await save(result); console.log(json({ saved, result })); return;
  }
  if (command === 'quote-agent') {
    const b = await budget(), p = requireVaultCommerce(b), state = await readVault(p.vault, p.network);
    if (state.config.owner_id !== p.account || state.config.policy.require_confidential) throw new Error('COMMERCE_PRIVATE_POLICY');
    const request = agentRequestSchema.parse(await read(required('request')));
    if (!p.allowedAgentHandles.includes(request.handle)) throw new Error('AGENT_APPROVAL_BINDING');
    const quote = await new AgentMarketClient().quote(request, required('maximum-amount'));
    console.log(json({ saved: await save(quote), handle: quote.request.handle, amountAtomicUsdc: quote.requirement.amount, payee: quote.requirement.payTo, vaultPaymentSupported: false, note: 'Quote only; marketplace delegated wallet payment is incompatible with vault custody.' })); return;
  }
  if (command === 'pay-agent') {
    throw new Error('AGENT_VAULT_PAYMENT_UNSUPPORTED: the documented marketplace rail requires owner-wallet delegated ft_transfer. No payment was signed or dispatched.');
  }
  if (command === 'observe-agent' || command === 'settle-agent' || command === 'expire-agent') {
    const b = await budget(), id = required('id');
    const result = command === 'observe-agent' ? await observeAgentJob(b, id) : command === 'settle-agent' ? await settleAgentJob(b, id, required('hash'), required('relayer')) : await observeAgentExpiry(await owner(b), b, id);
    console.log(json({ id, saved: await save(result) })); return;
  }
  console.log('Usage: npm run commerce -- <status|position|plan-storage|plan-lending|plan-payment|submit|observe-transaction|quote-agent|observe-agent|settle-agent|expire-agent> [options]\nAmounts are atomic units of the vault fixed token. Agent Market payment is unsupported. See docs/COMMERCE.md.');
  if (command) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof z.ZodError ? 'Invalid commerce input schema; input values omitted.' : error instanceof Error ? error.message : 'Commerce operation failed.'); process.exitCode = 1; });
