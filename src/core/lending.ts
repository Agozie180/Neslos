import { z } from 'zod';
import { units } from './amounts.js';
import { canonical, sha256 } from './crypto.js';
import { nearContractMethods, viewNear, type NearNetwork } from './near.js';
import { nearAccount } from './wire.js';

export const RHEA_CONTRACTS = { mainnet: 'contract.main.burrow.near', testnet: 'contract.1689937928.burrow.testnet' } as const;
const atomic = z.string().refine(value => { try { units(value); return true; } catch { return false; } });
const pool = z.object({ shares: atomic, balance: atomic });
const assetSchema = z.object({
  token_id: nearAccount, supplied: pool, borrowed: pool,
  config: z.object({ extra_decimals: z.number().int().min(0).max(24), can_deposit: z.boolean(), can_withdraw: z.boolean(), supplied_limit: atomic.optional() }),
  supply_apr: z.string().optional(), last_update_timestamp: atomic,
});
const positionAsset = z.object({ token_id: nearAccount, shares: atomic, balance: atomic });
const accountSchema = z.object({ account_id: nearAccount, supplied: z.array(positionAsset), borrowed: z.array(positionAsset) }).passthrough().nullable();
export const lendingSnapshotSchema = z.object({
  format: z.literal('neslos-rhea-snapshot-v1'), network: z.enum(['mainnet', 'testnet']),
  contract: nearAccount, account: nearAccount, token: nearAccount,
  asset: assetSchema, position: accountSchema, walletBalance: atomic,
  tokenDecimals: z.number().int().min(0).max(24), blockHash: z.string().min(10).max(64), blockHeight: z.number().int().positive(), fetchedAt: z.iso.datetime(),
}).strict();
export type LendingSnapshot = z.infer<typeof lendingSnapshotSchema>;

/** All balances and conversion inputs are queried at one finalized block. */
export async function readLendingPosition(account: string, token: string, network: NearNetwork, read = viewNear, inspect = nearContractMethods): Promise<LendingSnapshot> {
  nearAccount.parse(account); nearAccount.parse(token);
  const contract = RHEA_CONTRACTS[network];
  const asset = await read(contract, 'get_asset', { token_id: token }, network);
  if (asset.value === null || asset.value === undefined) throw new Error('LENDING_ASSET_UNSUPPORTED');
  const parsedAsset = assetSchema.safeParse(asset.value);
  if (!parsedAsset.success) throw new Error('LENDING_ASSET_INVALID', { cause: parsedAsset.error });
  let tokenInterface: Awaited<ReturnType<typeof nearContractMethods>>;
  try { tokenInterface = await inspect(token, network, asset.blockHash); }
  catch (error) { throw new Error('LENDING_TOKEN_INTERFACE_UNAVAILABLE', { cause: error }); }
  if (tokenInterface.blockHash !== asset.blockHash || tokenInterface.blockHeight !== asset.blockHeight) throw new Error('LENDING_SNAPSHOT_CHANGED');
  const methods = new Set(tokenInterface.methods);
  if (!methods.has('ft_metadata')) throw new Error('LENDING_TOKEN_METADATA_UNAVAILABLE');
  if (!methods.has('ft_transfer_call')) throw new Error('LENDING_TOKEN_TRANSFER_CALL_UNAVAILABLE');
  const results = await Promise.allSettled([
    read(contract, 'get_account', { account_id: account }, network, asset.blockHash),
    read(token, 'ft_balance_of', { account_id: account }, network, asset.blockHash),
    read(token, 'ft_metadata', {}, network, asset.blockHash),
  ]);
  const positionResult = results[0]!, balanceResult = results[1]!, metadataResult = results[2]!;
  if (metadataResult.status === 'rejected') throw new Error('LENDING_TOKEN_METADATA_UNAVAILABLE', { cause: metadataResult.reason });
  if (positionResult.status === 'rejected') throw positionResult.reason;
  if (balanceResult.status === 'rejected') throw balanceResult.reason;
  const position = positionResult.value, balance = balanceResult.value, metadata = metadataResult.value;
  for (const result of [position, balance, metadata]) if (result.blockHash !== asset.blockHash) throw new Error('LENDING_SNAPSHOT_CHANGED');
  const snapshot = lendingSnapshotSchema.parse({ format: 'neslos-rhea-snapshot-v1', network, contract, account, token,
    asset: parsedAsset.data, position: position.value, walletBalance: balance.value, tokenDecimals: z.object({ decimals: z.number() }).parse(metadata.value).decimals,
    blockHash: asset.blockHash, blockHeight: asset.blockHeight, fetchedAt: new Date().toISOString() });
  assertSnapshot(snapshot);
  return snapshot;
}

function assertSnapshot(snapshot: LendingSnapshot) {
  if (snapshot.contract !== RHEA_CONTRACTS[snapshot.network] || snapshot.asset.token_id !== snapshot.token || (snapshot.position && snapshot.position.account_id !== snapshot.account)) throw new Error('LENDING_IDENTITY_BINDING');
  if (snapshot.tokenDecimals + snapshot.asset.config.extra_decimals > 38) throw new Error('LENDING_DECIMAL_RANGE');
  for (const kind of ['supplied', 'borrowed'] as const) {
    const entries = snapshot.position?.[kind] ?? [];
    if (new Set(entries.map(row => row.token_id)).size !== entries.length) throw new Error('LENDING_DUPLICATE_POSITION');
  }
}
export function lendingPosition(snapshot: LendingSnapshot) {
  lendingSnapshotSchema.parse(snapshot); assertSnapshot(snapshot);
  const supplied = snapshot.position?.supplied.find(row => row.token_id === snapshot.token);
  const factor = 10n ** BigInt(snapshot.asset.config.extra_decimals);
  return {
    token: snapshot.token, shares: supplied?.shares ?? '0',
    protocolBalance: supplied?.balance ?? '0',
    underlyingAtomic: ((supplied ? units(supplied.balance) : 0n) / factor).toString(),
    protocolDust: ((supplied ? units(supplied.balance) : 0n) % factor).toString(),
    hasDebt: snapshot.position?.borrowed.some(row => units(row.balance) > 0n) ?? false,
    publicPosition: true as const,
  };
}

export const lendingPlanSchema = z.object({
  format: z.literal('neslos-rhea-plan-v1'), operation: z.enum(['supply', 'withdraw']),
  snapshot: lendingSnapshotSchema, amount: atomic, maximumAmount: atomic,
  allowPublicPosition: z.literal(true), requestId: z.string().uuid(),
}).strict();
export type LendingPlan = z.infer<typeof lendingPlanSchema>;
export const lendingPlanHash = (plan: LendingPlan) => sha256(canonical(lendingPlanSchema.parse(plan)));

/** Reconstruct fixed protocol calls; no arbitrary contract, msg, collateral or debt action. */
export function lendingCall(input: LendingPlan, now = Date.now()) {
  const plan = lendingPlanSchema.parse(input), s = plan.snapshot;
  assertSnapshot(s);
  const age = now - Date.parse(s.fetchedAt);
  if (age < -5000 || age > 60_000) throw new Error('LENDING_STALE_PLAN');
  const amount = units(plan.amount), ceiling = units(plan.maximumAmount);
  if (amount === 0n || amount > ceiling) throw new Error('LENDING_AMOUNT_LIMIT');
  const protocolAmount = amount * 10n ** BigInt(s.asset.config.extra_decimals);
  if (protocolAmount > (1n << 128n) - 1n) throw new Error('LENDING_AMOUNT_OVERFLOW');
  if (plan.operation === 'supply') {
    if (!s.asset.config.can_deposit) throw new Error('LENDING_DEPOSITS_DISABLED');
    if (amount > units(s.walletBalance)) throw new Error('LENDING_INSUFFICIENT_BALANCE');
    if (s.asset.config.supplied_limit !== undefined && units(s.asset.supplied.balance) + protocolAmount > units(s.asset.config.supplied_limit)) throw new Error('LENDING_SUPPLY_LIMIT');
    // Empty msg is Rhea's non-collateral supply path. It cannot borrow or increase collateral.
    return { receiverId: s.token, methodName: 'ft_transfer_call', args: { receiver_id: s.contract, amount: plan.amount, msg: '' }, gas: '180000000000000', deposit: '1' };
  }
  if (!s.asset.config.can_withdraw) throw new Error('LENDING_WITHDRAWALS_DISABLED');
  const position = lendingPosition(s);
  if (position.hasDebt) throw new Error('LENDING_DEBT_REQUIRES_SEPARATE_REVIEW');
  if (protocolAmount > units(position.protocolBalance)) throw new Error('LENDING_INSUFFICIENT_SUPPLIED');
  return { receiverId: s.contract, methodName: 'execute', args: { actions: [{ Withdraw: { token_id: s.token, max_amount: protocolAmount.toString() } }] }, gas: '180000000000000', deposit: '1' };
}

/** Position observation is separate from a successful token receipt. Never fabricate yield. */
export function observeLendingChange(before: LendingSnapshot, after: LendingSnapshot, operation: 'supply' | 'withdraw') {
  for (const key of ['network', 'contract', 'account', 'token', 'tokenDecimals'] as const) if (before[key] !== after[key]) throw new Error('LENDING_OBSERVATION_BINDING');
  if (after.blockHeight <= before.blockHeight) throw new Error('LENDING_OBSERVATION_NOT_NEW');
  const previous = lendingPosition(before), current = lendingPosition(after);
  const sharesDelta = BigInt(current.shares) - BigInt(previous.shares);
  return { observed: operation === 'supply' ? sharesDelta > 0n : sharesDelta < 0n,
    sharesDelta: sharesDelta.toString(), underlyingAtomic: current.underlyingAtomic,
    walletDelta: (units(after.walletBalance) - units(before.walletBalance)).toString(),
    blockHash: after.blockHash, blockHeight: after.blockHeight, publicPosition: true as const };
}
