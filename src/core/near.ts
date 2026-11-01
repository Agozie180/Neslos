import { z } from 'zod';
import { fetchJson } from './research.js';
import { chainBudgetSchema, nearAccount, vaultConfigSchema } from './wire.js';
import { units } from './amounts.js';

const rpcUrls = { mainnet: 'https://rpc.mainnet.near.org', testnet: 'https://rpc.testnet.near.org' } as const;
export async function viewNear(account: string, method: string, args: unknown, network: 'mainnet' | 'testnet', blockHash?: string) {
  nearAccount.parse(account);
  const response = await fetchJson(rpcUrls[network], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'neslos-view', method: 'query', params: { request_type: 'call_function', account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), ...(blockHash ? { block_id: blockHash } : { finality: 'final' }) } }) }) as { error?: unknown; result?: { result: number[]; block_hash: string; block_height: number } };
  if (response.error || !response.result || !Array.isArray(response.result.result)) throw new Error('NEAR_VIEW: the finalized contract view failed.');
  return { value: JSON.parse(Buffer.from(response.result.result).toString('utf8')), blockHash: response.result.block_hash, blockHeight: response.result.block_height };
}
export async function readVault(vault: string, network: 'mainnet' | 'testnet') {
  const configView = await viewNear(vault, 'get_config', {}, network);
  const config = vaultConfigSchema.parse(configView.value);
  if (config.network !== network) throw new Error('NEAR_DOMAIN: vault network mismatch.');
  const results = await Promise.allSettled([
    viewNear(vault, 'get_budget', {}, network, configView.blockHash),
    viewNear(config.token_id, 'ft_balance_of', { account_id: vault }, network, configView.blockHash),
  ]);
  for (const r of results) if (r.status === 'rejected') throw new Error('NEAR_STATE: could not verify a coherent budget and token balance.', { cause: r.reason });
  const [budgetView, balanceView] = results.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof viewNear>>>).value);
  const budget = chainBudgetSchema.parse(budgetView!.value);
  const balance = z.string().parse(balanceView!.value); units(balance);
  if (config.policy_version !== budget.policy_version) throw new Error('NEAR_SNAPSHOT: inconsistent finalized policy version.');
  return { config, budget, balance, blockHash: configView.blockHash, blockHeight: configView.blockHeight };
}
