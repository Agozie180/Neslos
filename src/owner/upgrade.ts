import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Account, actions, baseEncode } from 'near-api-js';
import { z } from 'zod';
import { canonical, sha256 } from '../core/crypto.js';
import { retryNearRead } from '../core/near.js';
import { hashHex, vaultConfigSchema } from '../core/wire.js';
import { submitOnce, transactionOutcome, type connectOwner } from './account.js';

export const UPGRADE_OWNER = 'neslos.testnet';
export const UPGRADE_VAULT = 'vault.neslos.testnet';
export const EXISTING_VAULT_SHA256 = '196460a40676c7901143a9adf63ce61f63e25bf862e0acb4d9d51ff491e32b73';
type Owner = Awaited<ReturnType<typeof connectOwner>>;
const publicKeySchema = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const upgradePlanSchema = z.object({
  format: z.literal('neslos-testnet-vault-upgrade-v1'), network: z.literal('testnet'), owner: z.literal(UPGRADE_OWNER), vault: z.literal(UPGRADE_VAULT),
  ownerPublicKey: publicKeySchema, oldCodeSha256: hashHex, newCodeSha256: hashHex, newCodeBytes: z.number().int().min(8).max(4_194_304),
  stateFingerprint: hashHex, config: vaultConfigSchema,
  observedBlockHash: z.string().min(10).max(64), observedBlockHeight: z.number().int().positive(), createdAt: z.iso.datetime(),
}).strict().superRefine((p, ctx) => {
  if (p.config.owner_id !== p.owner || p.config.network !== p.network || p.config.token_id !== 'token.neslos.testnet' || !p.config.policy.paused) ctx.addIssue({ code: 'custom', message: 'Upgrade only the existing paused testnet fixture vault.' });
  if (p.oldCodeSha256 === p.newCodeSha256) ctx.addIssue({ code: 'custom', message: 'Upgrade requires different reviewed code.' });
});
export type UpgradePlan = z.infer<typeof upgradePlanSchema>;
export const upgradePlanHash = (input: UpgradePlan) => sha256(canonical(upgradePlanSchema.parse(input)));
function checkOwner(owner: Owner) {
  if (owner.network !== 'testnet' || owner.account.accountId !== UPGRADE_OWNER) throw new Error('UPGRADE_TESTNET_OWNER_ONLY');
  publicKeySchema.parse(owner.publicKey.toString());
}
function checkedWasm(input: Uint8Array) {
  const wasm = Buffer.from(input); // freeze bytes across asynchronous preflight and signing
  if (wasm.length < 8 || wasm.length > 4_194_304 || !wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('UPGRADE_INVALID_WASM');
  return wasm;
}
const base64 = z.string().refine(v => Buffer.from(v, 'base64').toString('base64') === v);
export function upgradeStateFingerprint(input: unknown) {
  const values = z.array(z.object({ key: base64, value: base64 }).strict()).min(1).max(10000).parse(input);
  if (new Set(values.map(v => v.key)).size !== values.length || values.reduce((n, v) => n + v.key.length + v.value.length, 0) > 5_600_000) throw new Error('UPGRADE_INVALID_STATE');
  return sha256(canonical(values.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
}

/** Keys anchor a single finalized snapshot; code, raw state and config must match that block. */
export async function inspectVaultUpgrade(owner: Owner) {
  checkOwner(owner);
  if (await retryNearRead(() => owner.provider.getNetworkId()) !== 'testnet') throw new Error('UPGRADE_RPC_NETWORK');
  const keys = await retryNearRead(() => owner.provider.viewAccessKeyList({ accountId: UPGRADE_VAULT, finalityQuery: { finality: 'final' } }));
  if (keys.keys.length !== 1 || keys.keys[0]?.public_key !== owner.publicKey.toString() || keys.keys[0]?.access_key.permission !== 'FullAccess') throw new Error('UPGRADE_ACCESS_KEYS_CHANGED');
  const blockQuery = { blockId: keys.block_hash };
  const results = await Promise.allSettled([
    retryNearRead(() => owner.provider.viewContractCode({ contractId: UPGRADE_VAULT, blockQuery })),
    retryNearRead(() => owner.provider.callFunctionRaw({ contractId: UPGRADE_VAULT, method: 'get_config', args: {}, blockQuery })),
    retryNearRead(() => owner.provider.viewContractState({ contractId: UPGRADE_VAULT, prefix: '', blockQuery })),
  ]);
  for (const result of results) if (result.status === 'rejected') throw new Error('UPGRADE_SNAPSHOT_UNAVAILABLE', { cause: result.reason });
  const code = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<Owner['provider']['viewContractCode']>>>).value;
  const configView = (results[1] as PromiseFulfilledResult<Awaited<ReturnType<Owner['provider']['callFunctionRaw']>>>).value;
  const state = (results[2] as PromiseFulfilledResult<Awaited<ReturnType<Owner['provider']['viewContractState']>>>).value;
  for (const result of [code, configView, state]) if (result.block_hash !== keys.block_hash || result.block_height !== keys.block_height) throw new Error('UPGRADE_INCOHERENT_SNAPSHOT');
  const codeSha256 = sha256(code.code);
  if (baseEncode(Buffer.from(codeSha256, 'hex')) !== code.hash) throw new Error('UPGRADE_CODE_HASH_MISMATCH');
  const config = vaultConfigSchema.parse(JSON.parse(Buffer.from(configView.result).toString('utf8')));
  if (config.owner_id !== UPGRADE_OWNER || config.network !== 'testnet' || config.token_id !== 'token.neslos.testnet') throw new Error('UPGRADE_CONFIG_BINDING');
  if (!config.policy.paused) throw new Error('UPGRADE_VAULT_NOT_PAUSED');
  return { codeSha256, chainCodeHash: code.hash, stateFingerprint: upgradeStateFingerprint(state.values), config, ownerPublicKey: owner.publicKey.toString(), blockHash: keys.block_hash, blockHeight: keys.block_height };
}

export async function planVaultUpgrade(owner: Owner, wasmInput: Uint8Array, expectedOldSha256 = EXISTING_VAULT_SHA256): Promise<UpgradePlan> {
  checkOwner(owner); hashHex.parse(expectedOldSha256);
  const wasm = checkedWasm(wasmInput), snapshot = await inspectVaultUpgrade(owner);
  if (snapshot.codeSha256 !== expectedOldSha256) throw new Error('UPGRADE_OLD_CODE_CHANGED');
  return upgradePlanSchema.parse({ format: 'neslos-testnet-vault-upgrade-v1', network: 'testnet', owner: UPGRADE_OWNER, vault: UPGRADE_VAULT,
    ownerPublicKey: snapshot.ownerPublicKey, oldCodeSha256: snapshot.codeSha256, newCodeSha256: sha256(wasm), newCodeBytes: wasm.length,
    stateFingerprint: snapshot.stateFingerprint, config: snapshot.config, observedBlockHash: snapshot.blockHash, observedBlockHeight: snapshot.blockHeight, createdAt: new Date().toISOString() });
}

/** Exactly one DeployContract. No initializer, migration, transfer, key change or policy call. */
export async function executeVaultUpgrade(owner: Owner, input: UpgradePlan, wasmInput: Uint8Array, approvedHash: string, journalDirectory: string) {
  checkOwner(owner);
  const plan = upgradePlanSchema.parse(input), hash = upgradePlanHash(plan), wasm = checkedWasm(wasmInput);
  if (hash !== approvedHash || plan.ownerPublicKey !== owner.publicKey.toString()) throw new Error('UPGRADE_APPROVAL_BINDING');
  if (sha256(wasm) !== plan.newCodeSha256 || wasm.length !== plan.newCodeBytes) throw new Error('UPGRADE_ARTIFACT_CHANGED');
  const path = join(journalDirectory, 'upgrade-' + hash + '.json');
  let journalExists = false;
  try { await access(path); journalExists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // A pending or finalized saved transaction is recovered even after deployment changed code.
  if (!journalExists) {
    const before = await inspectVaultUpgrade(owner);
    if (before.codeSha256 === plan.newCodeSha256) throw new Error('UPGRADE_ALREADY_DEPLOYED_WITHOUT_JOURNAL');
    if (before.codeSha256 !== plan.oldCodeSha256) throw new Error('UPGRADE_OLD_CODE_CHANGED');
    if (before.stateFingerprint !== plan.stateFingerprint || canonical(before.config) !== canonical(plan.config)) throw new Error('UPGRADE_STATE_CHANGED');
  }
  const signer = owner.account.getSigner();
  if (!signer || (await signer.getPublicKey()).toString() !== plan.ownerPublicKey) throw new Error('UPGRADE_SIGNER_BINDING');
  const vaultAccount = new Account(UPGRADE_VAULT, owner.provider, signer);
  const transaction = await submitOnce(vaultAccount, 'testnet', path, UPGRADE_VAULT, [actions.deployContract(wasm)]);
  if (!transactionOutcome(transaction.outcome).success) throw new Error('UPGRADE_TRANSACTION_FAILED: observe the saved transaction; do not create a replacement.');
  const after = await inspectVaultUpgrade(owner);
  if (after.codeSha256 !== plan.newCodeSha256) throw new Error('UPGRADE_POST_CODE_MISMATCH');
  if (after.stateFingerprint !== plan.stateFingerprint || canonical(after.config) !== canonical(plan.config)) throw new Error('UPGRADE_POST_STATE_CHANGED');
  return { format: 'neslos-testnet-vault-upgrade-proof-v1' as const, network: 'testnet' as const, owner: UPGRADE_OWNER, vault: UPGRADE_VAULT,
    planHash: hash, transactionHash: transaction.hash, explorer: 'https://testnet.nearblocks.io/txns/' + transaction.hash,
    oldCodeSha256: plan.oldCodeSha256, newCodeSha256: after.codeSha256, stateFingerprint: after.stateFingerprint, configUnchanged: true,
    rawStateUnchanged: true, soleOwnerKeyVerified: true, config: after.config, blockHash: after.blockHash, blockHeight: after.blockHeight, verifiedAt: new Date().toISOString() };
}
