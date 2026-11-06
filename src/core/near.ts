import { z } from 'zod';
import { FailoverRpcError, FailoverRpcProvider, JsonRpcProvider } from 'near-api-js';
import { AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import { chainBudgetSchema, nearAccount, vaultConfigSchema } from './wire.js';
import { units } from './amounts.js';

export const rpcUrls = { mainnet: 'https://rpc.mainnet.near.org', testnet: 'https://test.rpc.fastnear.com' } as const;
export type NearNetwork = keyof typeof rpcUrls;
/** Absence must be confirmed for this account by every attempted provider. */
export function isMissingNearAccount(error: unknown, account: string): boolean {
  if (error instanceof AccountDoesNotExistError) return error.accountId === account;
  return error instanceof FailoverRpcError && error.errors.length > 0
    && error.errors.every(cause => isMissingNearAccount(cause, account));
}
function isTransportFailure(error: unknown): boolean {
  if (error instanceof FailoverRpcError) return error.errors.length > 0 && error.errors.every(isTransportFailure);
  return error instanceof TypeError && error.message === 'fetch failed';
}
/** Retry reads only. The SDK's retry matcher misses Node's lowercase "fetch failed". */
export async function retryNearRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || !isTransportFailure(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}
export function nearProvider(network: NearNetwork) {
  const urls = network === 'testnet'
    ? [rpcUrls.testnet, 'https://rpc.testnet.near.org']
    : [rpcUrls.mainnet, 'https://free.rpc.fastnear.com'];
  return new FailoverRpcProvider(urls.map(url => new JsonRpcProvider({ url }, { retries: 2, wait: 500, backoff: 2 })));
}
export async function viewNear(account: string, method: string, args: unknown, network: 'mainnet' | 'testnet', blockHash?: string) {
  nearAccount.parse(account);
  const response = await retryNearRead(() => nearProvider(network).callFunctionRaw({
    contractId: account, method, args: z.record(z.string(), z.unknown()).parse(args),
    blockQuery: blockHash ? { blockId: blockHash } : { finality: 'final' },
  }));
  if (blockHash && response.block_hash !== blockHash) throw new Error('NEAR_SNAPSHOT: provider returned a different block from the requested one.');
  return { value: JSON.parse(Buffer.from(response.result).toString('utf8')), blockHash: response.block_hash, blockHeight: response.block_height };
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
  for (const view of [budgetView!, balanceView!]) {
    if (view.blockHash !== configView.blockHash || view.blockHeight !== configView.blockHeight) throw new Error('NEAR_SNAPSHOT: inconsistent finalized block identity.');
  }
  const budget = chainBudgetSchema.parse(budgetView!.value);
  const balance = z.string().parse(balanceView!.value); units(balance);
  if (config.policy_version !== budget.policy_version) throw new Error('NEAR_SNAPSHOT: inconsistent finalized policy version.');
  const limit = units(config.policy.daily_limit), used = units(budget.used);
  const remaining = used >= limit ? 0n : limit - used;
  if (units(budget.remaining) !== remaining || budget.paused !== config.policy.paused) throw new Error('NEAR_SNAPSHOT: budget contradicts the finalized policy.');
  return { config, budget, balance, blockHash: configView.blockHash, blockHeight: configView.blockHeight };
}
