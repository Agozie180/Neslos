import { z } from 'zod';
import { formatUsdc, minimumOutput, units } from './amounts.js';
import type { BudgetSnapshot, GuardianDecision, Policy, PolicyCheck, Proposal } from './types.js';

const amount = z.string().refine(v => { try { return units(v) > 0n; } catch { return false; } }, 'Use a positive integer amount in USDC base units.');
const uniqueList = z.array(z.string().min(1).max(100)).min(1).max(32).refine(v => new Set(v).size === v.length, 'Duplicate entries are not allowed.');

export const policySchema = z.object({
  id: z.string().min(1).max(80), version: z.number().int().positive(), name: z.string().trim().min(2).max(60),
  dailyLimit: amount, perTransactionLimit: amount, maxSlippageBps: z.number().int().min(0).max(1000),
  allowedVenues: uniqueList, allowedCounterparties: uniqueList,
  requireConfidential: z.boolean(), stablecoinsOnly: z.boolean(), allowBridgedAssets: z.boolean(),
  minimumLiquidityUsd: z.number().finite().min(0).max(1e12), maxQuoteAgeSeconds: z.number().int().min(5).max(300), paused: z.boolean(),
}).strict().refine(p => units(p.perTransactionLimit) <= units(p.dailyLimit), 'Per-action limit cannot exceed the daily limit.');

export const DEFAULT_POLICY: Policy = {
  id: 'neslos-treasury', version: 1, name: 'Treasury guard', dailyLimit: '500000000', perTransactionLimit: '200000000',
  maxSlippageBps: 50, allowedVenues: ['near-intents', 'rhea-lending'], allowedCounterparties: ['research-agent', 'treasury-reserve'],
  requireConfidential: true, stablecoinsOnly: true, allowBridgedAssets: false, minimumLiquidityUsd: 100_000,
  maxQuoteAgeSeconds: 60, paused: false,
};

export function checkPolicy(policy: Policy, proposal: Proposal, budget: BudgetSnapshot, now = Date.now()): GuardianDecision {
  const checks: PolicyCheck[] = [];
  const add = (code: string, label: string, passed: boolean, detail: string) => checks.push({ code, label, passed, detail });
  let requested = 0n;
  let validAmount = true;
  try { requested = units(proposal.amount); validAmount = requested > 0n; } catch { validAmount = false; }
  add('AMOUNT', 'Exact USDC amount', validAmount && proposal.asset === 'USDC', validAmount ? `${formatUsdc(proposal.amount)} USDC, represented in integer base units.` : 'Invalid or zero amount.');
  add('PAUSED', 'Vault enabled', !policy.paused, policy.paused ? 'The owner has paused the policy.' : 'The owner has enabled this policy.');
  add('POLICY_VERSION', 'Current policy', proposal.policyId === policy.id && proposal.policyVersion === policy.version, `Proposal v${proposal.policyVersion}; active v${policy.version}.`);
  add('NONCE', 'No replay', proposal.nonce === budget.nextNonce, 'The authorization must use the next unused nonce.');
  add('PER_ACTION', 'Per-action ceiling', validAmount && requested <= units(policy.perTransactionLimit), `${validAmount ? formatUsdc(proposal.amount) : 'Invalid'} / ${formatUsdc(policy.perTransactionLimit)} USDC.`);
  add('DAILY_LIMIT', 'Shared daily allowance', validAmount && requested <= units(budget.remaining), `${formatUsdc(budget.remaining)} USDC remains today, including outstanding reservations.`);
  add('BALANCE', 'Available funds', validAmount && requested <= units(budget.balance), `${formatUsdc(budget.balance)} USDC available in the rehearsal vault.`);
  add('VENUE', 'Allowed venue', policy.allowedVenues.includes(proposal.venue) && (!proposal.strategyVenue || policy.allowedVenues.includes(proposal.strategyVenue)), `${proposal.venue}${proposal.strategyVenue ? ` → ${proposal.strategyVenue}` : ''} must be explicitly allowed.`);
  add('COUNTERPARTY', 'Allowed counterparty', policy.allowedCounterparties.includes(proposal.counterparty), `${proposal.counterparty} must be explicitly allowed.`);
  const validSlip = Number.isSafeInteger(proposal.slippageBps) && proposal.slippageBps >= 0 && proposal.slippageBps <= policy.maxSlippageBps;
  let validMinimum = false;
  try { validMinimum = units(proposal.quotedOutput) > 0n && units(proposal.minimumOutput) > 0n && units(proposal.minimumOutput) >= units(minimumOutput(proposal.quotedOutput, proposal.slippageBps)) && units(proposal.minimumOutput) <= units(proposal.quotedOutput); } catch { /* fail closed */ }
  add('SLIPPAGE', 'Slippage and output floor', validSlip && validMinimum, `${proposal.slippageBps} bps requested; ${policy.maxSlippageBps} bps maximum. The output floor is checked independently.`);
  const timeValid = Number.isSafeInteger(proposal.quotedAt) && Number.isSafeInteger(proposal.expiresAt) && proposal.quotedAt <= now && now - proposal.quotedAt <= policy.maxQuoteAgeSeconds * 1000 && proposal.expiresAt > now && proposal.expiresAt <= proposal.quotedAt + 300_000;
  add('QUOTE_FRESHNESS', 'Fresh authorization', timeValid, timeValid ? 'The quote is within its freshness and expiry bounds.' : 'The quote is stale, expired, from the future, or valid for too long.');
  add('PRIVACY', 'Required privacy', !policy.requireConfidential || (proposal.privacy === 'confidential' && proposal.kind !== 'public-lending'), policy.requireConfidential ? 'Confidential settlement is required. Public lending deposits cannot pass this policy.' : 'The owner permits public settlement.');
  return { allowed: checks.every(c => c.passed), checks, checkedAt: new Date(now).toISOString(), policyVersion: policy.version };
}
