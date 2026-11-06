import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AgentMarketClient, agentQuoteHash, agentQuoteSchema, agentRequestSchema } from '../src/core/agent-market.js';
import { readLendingPosition, lendingPosition, RHEA_CONTRACTS } from '../src/core/lending.js';
import { NATIVE_USDC } from '../src/core/research.js';
import { connectOwner, json, writePrivateJson } from '../src/owner/account.js';
import { CommerceBudget, commercePolicySchema } from '../src/owner/commerce-budget.js';
import { commerceCall, commercePlanHash, commercePlanSchema, executeCommercePlan, observeAgentExpiry, observeAgentJob, observeCommerceTransaction, payAgentJob, planCommerceStorage, planLending, settleAgentJob } from '../src/owner/commerce.js';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
  policy: { type: 'string', default: '.private/commerce/policy.json' },
  directory: { type: 'string', default: '.private/commerce' }, credentials: { type: 'string' },
  request: { type: 'string' }, plan: { type: 'string' }, out: { type: 'string' }, amount: { type: 'string' },
  'maximum-amount': { type: 'string' }, 'approve-hash': { type: 'string' }, 'allow-mainnet': { type: 'boolean', default: false },
  operation: { type: 'string' }, contract: { type: 'string' }, id: { type: 'string' }, hash: { type: 'string' }, relayer: { type: 'string' },
} });
const required = (name: keyof typeof v) => { const value = v[name]; if (typeof value !== 'string' || !value) throw new Error('Required option: --' + name); return value; };
const read = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8'));
const budget = async () => new CommerceBudget(v.directory, commercePolicySchema.parse(await read(v.policy)));
const owner = async () => { if (!v['allow-mainnet']) throw new Error('MAINNET_OPT_IN_REQUIRED'); return connectOwner('mainnet', required('credentials')); };
const save = async (value: unknown, exclusive = true) => { const out = required('out'); await writePrivateJson(out, value, exclusive); return resolve(out); };

async function main() {
  const command = positionals[0];
  if (command === 'status') { console.log(json(await (await budget()).status())); return; }
  if (command === 'position') {
    const b = await budget(), snapshot = await readLendingPosition(b.policy.account, NATIVE_USDC, 'mainnet');
    if (v.out) await save(snapshot);
    console.log(json({ account: b.policy.account, ...lendingPosition(snapshot), blockHash: snapshot.blockHash, blockHeight: snapshot.blockHeight })); return;
  }
  if (command === 'plan-lending' || command === 'plan-storage') {
    const b = await budget();
    const plan = command === 'plan-lending'
      ? await planLending(b, z.enum(['supply', 'withdraw']).parse(required('operation')), required('amount'))
      : await planCommerceStorage(b, v.contract === 'rhea' ? RHEA_CONTRACTS.mainnet : v.contract === 'usdc' ? NATIVE_USDC : required('contract'));
    if ('registered' in plan) { console.log(json(plan)); return; }
    const saved = await save(plan);
    console.log(json({ saved, approveHash: commercePlanHash(plan), call: commerceCall(plan), reservedNativeYocto: plan.nativeReservation })); return;
  }
  if (command === 'submit') {
    const plan = commercePlanSchema.parse(await read(required('plan')));
    if (commercePlanHash(plan) !== required('approve-hash')) throw new Error('COMMERCE_PLAN_BINDING');
    const result = await executeCommercePlan(await owner(), await budget(), plan, required('approve-hash'), join(v.directory, 'transactions'));
    console.log(json({ id: plan.id, final: result.final, success: result.success, hash: result.transaction.hash, note: 'Use observe-transaction to verify the actual position.' })); return;
  }
  if (command === 'observe-transaction') {
    const result = await observeCommerceTransaction(await owner(), await budget(), required('id'), join(v.directory, 'transactions'));
    const saved = await save(result); console.log(json({ saved, result })); return;
  }
  if (command === 'quote-agent') {
    const quote = await new AgentMarketClient().quote(agentRequestSchema.parse(await read(required('request'))), required('maximum-amount'));
    console.log(json({ saved: await save(quote), approveHash: agentQuoteHash(quote), handle: quote.request.handle, amountAtomicUsdc: quote.requirement.amount, payee: quote.requirement.payTo })); return;
  }
  if (command === 'pay-agent') {
    const quote = agentQuoteSchema.parse(await read(required('plan')));
    if (agentQuoteHash(quote) !== required('approve-hash')) throw new Error('AGENT_APPROVAL_BINDING');
    const result = await payAgentJob(await owner(), await budget(), quote, required('approve-hash'));
    console.log(json({ saved: await save(result), id: quote.request.messageId, taskId: result.dispatch.task.id, state: result.summary.state, delivered: result.summary.delivered, settlementVerified: result.settlementVerified })); return;
  }
  if (command === 'observe-agent' || command === 'settle-agent' || command === 'expire-agent') {
    const b = await budget(), id = required('id');
    const result = command === 'observe-agent' ? await observeAgentJob(b, id) : command === 'settle-agent' ? await settleAgentJob(b, id, required('hash'), required('relayer')) : await observeAgentExpiry(await owner(), b, id);
    console.log(json({ id, saved: await save(result) })); return;
  }
  console.log('Usage: npm run commerce -- <status|position|plan-storage|plan-lending|submit|observe-transaction|quote-agent|pay-agent|observe-agent|settle-agent|expire-agent> [options]\nAmounts are atomic native USDC (6 decimals). See docs/COMMERCE.md.');
  if (command) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof z.ZodError ? 'Invalid commerce input schema; input values omitted.' : error instanceof Error ? error.message : 'Commerce operation failed.'); process.exitCode = 1; });
