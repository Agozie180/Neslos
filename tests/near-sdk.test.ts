import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVault } from '../src/core/near.js';

// Real near-api-js transport/decoding with fixture RPC replies, not a live chain proof.
const policy = { daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, max_quote_age_ms: '60000', venue_commitments: ['aa'.repeat(32)], counterparty_commitments: ['bb'.repeat(32)], output_assets: ['nep141:token.testnet'], require_confidential: true, paused: false };
const config = { owner_id: 'owner.testnet', token_id: 'token.testnet', network: 'testnet', executor_public_key: 'cc'.repeat(32), policy_version: '1', policy };
const budget = { day: '20760', used: '150000000', remaining: '350000000', policy_version: '1', next_nonce: '1', paused: false };
function mockRpc(change: 'none' | 'version' | 'balance' = 'none') {
  const fetcher = vi.fn(async (_url, options) => {
    const request = JSON.parse(options.body), method = request.params.method_name;
    const value = method === 'get_config' ? config : method === 'get_budget' ? { ...budget, policy_version: change === 'version' ? '2' : '1' } : change === 'balance' ? '1e6' : '800000000';
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { result: [...Buffer.from(JSON.stringify(value))], logs: [], block_hash: 'fixture-final-block', block_height: 100 } }), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe('NEAR SDK finalized state reader', () => {
  it('pins budget and token balance to the configuration block', async () => {
    const rpc = mockRpc(), result = await readVault('vault.testnet', 'testnet');
    expect(result.balance).toBe('800000000'); expect(result.budget.used).toBe('150000000');
    const calls = rpc.mock.calls.map(([, options]) => JSON.parse(options.body).params);
    expect(calls[0]).toMatchObject({ account_id: 'vault.testnet', method_name: 'get_config', finality: 'final' });
    for (const call of calls.slice(1)) { expect(call.block_id).toBe('fixture-final-block'); expect(call.finality).toBeUndefined(); }
    expect(calls.find(c => c.method_name === 'ft_balance_of').account_id).toBe('token.testnet');
  });
  it('rejects contradictory policy versions', async () => {
    mockRpc('version'); await expect(readVault('vault.testnet', 'testnet')).rejects.toThrow('NEAR_SNAPSHOT');
  });
  it('rejects a noncanonical token balance', async () => {
    mockRpc('balance'); await expect(readVault('vault.testnet', 'testnet')).rejects.toThrow();
  });
});
