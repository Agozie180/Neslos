import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AgentMarketClient, agentEndpoint, agentTaskSummary } from '../src/core/agent-market.js';
import { NATIVE_USDC } from '../src/core/research.js';

const request = () => ({ handle: 'web-research', messageId: randomUUID(), brief: 'Review the public Rhea lending documentation and cite sources.' });
const row = { scheme: 'exact', network: 'near:mainnet', asset: NATIVE_USDC, amount: '100000', payTo: 'market-treasury.near', maxTimeoutSeconds: 4200 };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('Agent Market A2A/x402 client', () => {
  it('obtains the price without a payment and preserves the exact quoted row', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty('X-PAYMENT');
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body))).toMatchObject({ method: 'SendMessage', params: { message: { role: 'ROLE_USER' } } });
      return reply({ x402Version: 2, accepts: [{ ...row, extra: { quoted: true } }] }, 402);
    });
    const quote = await new AgentMarketClient(fetchImpl).quote(request(), '100000');
    expect(quote.requirement).toEqual({ ...row, extra: { quoted: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ ...row, amount: '100001' }, 'AGENT_PRICE_EXCEEDS_LIMIT'],
    [{ ...row, asset: 'other-token.near' }, 'AGENT_PAYMENT_RAIL_AMBIGUOUS'],
    [{ ...row, network: 'near:testnet' }, 'AGENT_PAYMENT_RAIL_AMBIGUOUS'],
  ])('refuses over-budget, substituted-asset and wrong-network quotes', async (changed, error) => {
    const client = new AgentMarketClient(async () => reply({ x402Version: 2, accepts: [changed] }, 402));
    await expect(client.quote(request(), '100000')).rejects.toThrow(String(error));
  });
  it('does not choose between ambiguous NEAR payment terms', async () => {
    const client = new AgentMarketClient(async () => reply({ x402Version: 2, accepts: [row, { ...row, payTo: 'other.near' }] }, 402));
    await expect(client.quote(request(), '100000')).rejects.toThrow('AGENT_PAYMENT_RAIL_AMBIGUOUS');
  });
  it('cannot redirect a payment to an arbitrary URL', () => {
    expect(agentEndpoint('web-research')).toBe('https://web-research.market.near.ai/a2a/v1');
    for (const handle of ['https://attacker.invalid', '../other', 'name:443', 'name@host', 'name.market.near.ai']) expect(() => agentEndpoint(handle)).toThrow();
  });
  it('treats a lost paid response as unknown and never retries it', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply({ x402Version: 2, accepts: [row] }, 402)).mockRejectedValueOnce(new Error('network failed'));
    const client = new AgentMarketClient(fetchImpl);
    const quote = await client.quote(request(), '100000');
    await expect(client.dispatch(quote, Buffer.from('fixture-payment').toString('base64'))).rejects.toThrow('AGENT_PAYMENT_OUTCOME_UNKNOWN');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('polls without payment and refuses a substituted task', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty('X-PAYMENT');
      expect(JSON.parse(String(init?.body))).toMatchObject({ method: 'GetTask', params: { id: 'expected-task' } });
      return reply({ result: { task: { id: 'other-task', status: { state: 'TASK_STATE_COMPLETED' } } } });
    });
    await expect(new AgentMarketClient(fetchImpl).task('web-research', 'expected-task')).rejects.toThrow('AGENT_TASK_SUBSTITUTION');
  });
  it('requires an actual deliverable and keeps payment verification separate', () => {
    expect(agentTaskSummary({ id: 'task', status: { state: 'TASK_STATE_COMPLETED' } })).toMatchObject({ delivered: false, settlementVerified: false });
    expect(agentTaskSummary({ id: 'task', status: { state: 'TASK_STATE_COMPLETED' }, artifacts: [{ parts: [{ text: 'A cited research result.' }] }] })).toMatchObject({ delivered: true, settlementVerified: false });
    expect(agentTaskSummary({ id: 'task', status: { state: 'TASK_STATE_FAILED' } })).toMatchObject({ terminal: true, delivered: false });
  });
});
