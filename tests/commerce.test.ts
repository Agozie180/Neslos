import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildDelegateAction, KeyPair, KeyPairSigner, type Action } from 'near-api-js';
import { AgentMarketClient, agentQuoteHash, type AgentQuote } from '../src/core/agent-market.js';
import { NATIVE_USDC } from '../src/core/research.js';
import { CommerceBudget, type CommercePolicy } from '../src/owner/commerce-budget.js';
import { agentPaymentCall, payAgentJob, planLending } from '../src/owner/commerce.js';
vi.mock('../src/core/near.js', async original => ({ ...await original<typeof import('../src/core/near.js')>(), viewNear: vi.fn(async () => ({ value: '1000000', blockHash: 'fixture', blockHeight: 100 })) }));
const policy: CommercePolicy = { format: 'neslos-commerce-policy-v1', account: 'owner.near', network: 'mainnet', totalLimitAtomic: '1000000', perActionLimitAtomic: '100000', totalNativeLimitYocto: '100', allowPublicLending: false, allowedAgentHandles: ['web-research'] };
const quote = (): AgentQuote => ({ format: 'neslos-agent-quote-v1', request: { handle: 'web-research', messageId: randomUUID(), brief: 'Review public Rhea documentation.' }, requirement: { scheme: 'exact', network: 'near:mainnet', asset: NATIVE_USDC, amount: '100000', payTo: 'market.near', maxTimeoutSeconds: 4200 }, quotedAt: new Date().toISOString(), maximumAmount: '100000' });
const budget = async () => new CommerceBudget(await mkdtemp(join(tmpdir(), 'neslos-commerce-service-')), policy);
// Real SDK signing/serialization with a throwaway test key; no account or network call.
const signer = () => {
  const key = KeyPair.fromRandom('ed25519'), local = new KeyPairSigner(key);
  return vi.fn(async ({ actions: requested, blockHeightTtl }: { actions: Action[]; blockHeightTtl: number }) => local.signDelegateAction(buildDelegateAction({
    senderId: 'owner.near', receiverId: NATIVE_USDC, actions: requested, nonce: 1n,
    maxBlockHeight: BigInt(100 + blockHeightTtl), publicKey: key.getPublicKey(),
  })));
};
describe('owner commerce policy and signing', () => {
  it('keeps public lending disabled until the owner explicitly enables it', async () => {
    await expect(planLending(await budget(), 'supply', '1')).rejects.toThrow('PUBLIC_LENDING_DISABLED');
  });
  it('constructs only one exact USDC transfer with one yoctoNEAR', () => {
    const action = agentPaymentCall(quote());
    expect(action.functionCall?.methodName).toBe('ft_transfer');
    expect(action.functionCall?.deposit).toBe(1n);
    expect(JSON.parse(Buffer.from(action.functionCall!.args).toString())).toEqual({ receiver_id: 'market.near', amount: '100000' });
  });
  it('rejects changed approvals, unapproved agents and expired quotes before a signature leaves', async () => {
    const sign = signer(), owner = { network: 'mainnet', account: { accountId: 'owner.near', createSignedMetaTransaction: sign } } as never;
    const q = quote(), b = await budget();
    await expect(payAgentJob(owner, b, q, '0'.repeat(64))).rejects.toThrow('AGENT_APPROVAL_BINDING');
    const bad = { ...q, request: { ...q.request, handle: 'unapproved' } };
    await expect(payAgentJob(owner, b, bad, agentQuoteHash(bad))).rejects.toThrow('AGENT_APPROVAL_BINDING');
    const stale = { ...q, quotedAt: new Date(Date.now() - 61000).toISOString() };
    await expect(payAgentJob(owner, b, stale, agentQuoteHash(stale))).rejects.toThrow('COMMERCE_OUTCOME_UNRESOLVED');
    expect(sign).not.toHaveBeenCalled();
  });
  it('pays once, caches the dispatch and blocks conflicting wallet nonces until reconciliation', async () => {
    const sign = signer(), owner = { network: 'mainnet', account: { accountId: 'owner.near', createSignedMetaTransaction: sign } } as never;
    const q = quote(), b = await budget();
    const market = new AgentMarketClient();
    const send = vi.spyOn(market, 'dispatch').mockResolvedValue({ task: { id: 'task', status: { state: 'TASK_STATE_WORKING' } }, paymentResponse: null });
    await payAgentJob(owner, b, q, agentQuoteHash(q), market);
    await payAgentJob(owner, b, q, agentQuoteHash(q), market);
    expect(send).toHaveBeenCalledTimes(1); expect(sign).toHaveBeenCalledTimes(1);
    const next = quote();
    await expect(payAgentJob(owner, b, next, agentQuoteHash(next), market)).rejects.toThrow('COMMERCE_PENDING_DELEGATE');
    const prepared = (await b.operation(q.request.messageId)).preparation as { payment: string; proof: unknown };
    expect(prepared).toHaveProperty('proof');
    const payment = JSON.parse(Buffer.from(prepared.payment, 'base64').toString());
    expect(payment.accepted).toEqual(q.requirement);
    expect(Buffer.from(payment.payload.signedDelegateAction, 'base64').length).toBeGreaterThan(200);
    expect(send).toHaveBeenCalledWith(q, prepared.payment);
    await b.observe(q.request.messageId, async () => ({ settlementVerified: true }));
    await payAgentJob(owner, b, next, agentQuoteHash(next), market);
    expect(sign).toHaveBeenCalledTimes(2);
  });
});
