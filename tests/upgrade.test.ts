import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseEncode, KeyPair } from 'near-api-js';
import { sha256 } from '../src/core/crypto.js';
import { executeVaultUpgrade, inspectVaultUpgrade, planVaultUpgrade, upgradePlanHash, upgradeStateFingerprint, UPGRADE_OWNER, UPGRADE_VAULT } from '../src/owner/upgrade.js';

const calls = vi.hoisted(() => ({ sign: vi.fn(), construct: vi.fn() }));
vi.mock('near-api-js', async original => {
  const sdk = await original<typeof import('near-api-js')>();
  return { ...sdk, Account: class {
    constructor(public accountId: string, public provider: unknown, signer: unknown) { calls.construct(accountId, signer); }
    createSignedTransaction(args: unknown) { return calls.sign(args); }
  } };
});
const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), oldWasm = Buffer.concat([header, Buffer.from('old')]), newWasm = Buffer.concat([header, Buffer.from('reviewed')]);
const key = KeyPair.fromRandom('ed25519').getPublicKey(), blockHash = 'fixture-finalized-upgrade-block';
let code: Buffer, config: ReturnType<typeof configuration>, values: { key: string; value: string }[], keys: { public_key: string; access_key: { nonce: number; permission: string } }[];
const configuration = () => ({ owner_id: UPGRADE_OWNER, token_id: 'token.neslos.testnet', network: 'testnet', executor_public_key: 'a'.repeat(64), policy_version: '5', policy: { daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, max_quote_age_ms: '60000', venue_commitments: ['b'.repeat(64)], counterparty_commitments: ['c'.repeat(64)], output_assets: ['nep141:token.neslos.testnet'], require_confidential: false, paused: true } });
const serial = Buffer.from('fixture-exact-signed-upgrade'), txHash = baseEncode(Buffer.from(sha256(serial), 'hex'));
const terminal = () => ({ final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash: txHash, signer_id: UPGRADE_VAULT, receiver_id: UPGRADE_VAULT } });
function connection() {
  const provider = {
    getNetworkId: vi.fn(async () => 'testnet'),
    viewAccessKeyList: vi.fn(async () => ({ keys: structuredClone(keys), block_hash: blockHash, block_height: 100 })),
    viewContractCode: vi.fn(async (_args: unknown) => ({ code: Buffer.from(code), hash: baseEncode(Buffer.from(sha256(code), 'hex')), block_hash: blockHash, block_height: 100 })),
    callFunctionRaw: vi.fn(async (_args: unknown) => ({ result: [...Buffer.from(JSON.stringify(config))], block_hash: blockHash, block_height: 100 })),
    viewContractState: vi.fn(async (_args: unknown) => ({ values: structuredClone(values), proof: [], block_hash: blockHash, block_height: 100 })),
    sendTransactionUntil: vi.fn(async () => { code = Buffer.from(newWasm); return terminal(); }),
    viewTransactionStatus: vi.fn(async () => terminal()),
  };
  const signer = { getPublicKey: vi.fn(async () => key) };
  return { network: 'testnet' as const, account: { accountId: UPGRADE_OWNER, getSigner: () => signer }, provider, publicKey: key };
}
const owner = (c: ReturnType<typeof connection>) => c as never;
const directory = () => mkdtemp(join(tmpdir(), 'neslos-upgrade-'));
beforeEach(() => {
  vi.clearAllMocks(); code = Buffer.from(oldWasm); config = configuration(); values = [{ key: 'U1RBVEU=', value: 'c3RvcmFnZQ==' }]; keys = [{ public_key: key.toString(), access_key: { nonce: 10, permission: 'FullAccess' } }];
  calls.sign.mockResolvedValue({ transaction: { encode: () => serial }, encode: () => Buffer.from('fixture-signed-envelope') });
});

describe('paused existing testnet vault upgrade', () => {
  it('pins the exact artifact, owner key, full raw state and unchanged configuration at one finalized block', async () => {
    const c = connection(), plan = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm));
    expect(plan).toMatchObject({ network: 'testnet', owner: UPGRADE_OWNER, vault: UPGRADE_VAULT, ownerPublicKey: key.toString(), oldCodeSha256: sha256(oldWasm), newCodeSha256: sha256(newWasm), config, stateFingerprint: upgradeStateFingerprint(values) });
    for (const read of [c.provider.viewContractCode, c.provider.callFunctionRaw, c.provider.viewContractState]) expect(read.mock.calls[0]![0]).toMatchObject({ blockQuery: { blockId: blockHash } });
    expect(calls.sign).not.toHaveBeenCalled();
  });
  it('refuses other owners/networks, unpaused state, additional keys or function-call access keys', async () => {
    const c = connection();
    await expect(inspectVaultUpgrade({ ...c, network: 'mainnet' } as never)).rejects.toThrow('UPGRADE_TESTNET_OWNER_ONLY');
    await expect(inspectVaultUpgrade({ ...c, account: { ...c.account, accountId: 'other.testnet' } } as never)).rejects.toThrow('UPGRADE_TESTNET_OWNER_ONLY');
    config.policy.paused = false; await expect(inspectVaultUpgrade(owner(c))).rejects.toThrow('UPGRADE_VAULT_NOT_PAUSED'); config.policy.paused = true;
    keys.push(structuredClone(keys[0]!)); await expect(inspectVaultUpgrade(owner(c))).rejects.toThrow('UPGRADE_ACCESS_KEYS_CHANGED'); keys.pop();
    keys[0]!.access_key.permission = 'FunctionCall'; await expect(inspectVaultUpgrade(owner(c))).rejects.toThrow('UPGRADE_ACCESS_KEYS_CHANGED');
    expect(calls.sign).not.toHaveBeenCalled();
  });
  it('refuses contradictory RPC snapshots or code hashes', async () => {
    const c = connection();
    c.provider.viewContractCode.mockResolvedValueOnce({ code: Buffer.from(code), hash: baseEncode(Buffer.from(sha256(code), 'hex')), block_hash: 'other-block', block_height: 101 });
    await expect(inspectVaultUpgrade(owner(c))).rejects.toThrow('UPGRADE_INCOHERENT_SNAPSHOT');
    c.provider.viewContractCode.mockResolvedValueOnce({ code: Buffer.from(code), hash: 'false-code-hash', block_hash: blockHash, block_height: 100 });
    await expect(inspectVaultUpgrade(owner(c))).rejects.toThrow('UPGRADE_CODE_HASH_MISMATCH');
  });
  it('requires the exact old code, approval hash and new bytes before signing', async () => {
    const c = connection(), dir = await directory();
    await expect(planVaultUpgrade(owner(c), newWasm, 'f'.repeat(64))).rejects.toThrow('UPGRADE_OLD_CODE_CHANGED');
    const p = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm));
    await expect(executeVaultUpgrade(owner(c), p, newWasm, '0'.repeat(64), dir)).rejects.toThrow('UPGRADE_APPROVAL_BINDING');
    await expect(executeVaultUpgrade(owner(c), p, Buffer.concat([newWasm, Buffer.from('changed')]), upgradePlanHash(p), dir)).rejects.toThrow('UPGRADE_ARTIFACT_CHANGED');
    expect(calls.sign).not.toHaveBeenCalled();
  });
  it('rechecks raw state, policy and access keys immediately before signing', async () => {
    const c = connection(), p = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm)), dir = await directory();
    values[0]!.value = 'Y2hhbmdlZA=='; await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir)).rejects.toThrow('UPGRADE_STATE_CHANGED');
    values[0]!.value = 'c3RvcmFnZQ=='; config.policy_version = '6'; await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir)).rejects.toThrow('UPGRADE_STATE_CHANGED');
    config.policy_version = '5'; keys[0]!.public_key = KeyPair.fromRandom('ed25519').getPublicKey().toString(); await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir)).rejects.toThrow('UPGRADE_ACCESS_KEYS_CHANGED');
    expect(calls.sign).not.toHaveBeenCalled();
  });
  it('signs as the vault with exactly DeployContract and persists an idempotent recovery journal', async () => {
    const c = connection(), p = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm)), dir = await directory();
    const result = await executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir);
    expect(result).toMatchObject({ transactionHash: txHash, newCodeSha256: sha256(newWasm), rawStateUnchanged: true, configUnchanged: true });
    expect(calls.construct).toHaveBeenCalledWith(UPGRADE_VAULT, c.account.getSigner());
    const signed = calls.sign.mock.calls[0]![0]; expect(signed.receiverId).toBe(UPGRADE_VAULT); expect(signed.actions).toHaveLength(1); expect(signed.actions[0].enum).toBe('deployContract');
    expect(Buffer.from(signed.actions[0].deployContract.code)).toEqual(newWasm);
    const saved = JSON.parse(await readFile(join(dir, 'upgrade-' + upgradePlanHash(p) + '.json'), 'utf8'));
    expect(saved).toMatchObject({ signer: UPGRADE_VAULT, receiver: UPGRADE_VAULT, hash: txHash, state: 'final' });
    await executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir);
    expect(calls.sign).toHaveBeenCalledTimes(1); expect(c.provider.sendTransactionUntil).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost response by original hash after code changed, without signing again', async () => {
    const c = connection(), p = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm)), dir = await directory();
    c.provider.sendTransactionUntil.mockImplementationOnce(async () => { code = Buffer.from(newWasm); throw new Error('lost reply'); });
    await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir)).rejects.toThrow('TRANSACTION_UNKNOWN');
    const recovered = await executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), dir);
    expect(recovered.transactionHash).toBe(txHash); expect(calls.sign).toHaveBeenCalledTimes(1);
    expect(c.provider.viewTransactionStatus).toHaveBeenCalledWith({ txHash, accountId: UPGRADE_VAULT, waitUntil: 'FINAL' });
  });
  it('never treats already installed code without its journal as permission to deploy again', async () => {
    const c = connection(), p = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm)); code = Buffer.from(newWasm);
    await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), await directory())).rejects.toThrow('UPGRADE_ALREADY_DEPLOYED_WITHOUT_JOURNAL');
    expect(calls.sign).not.toHaveBeenCalled();
  });
  it('does not report success when post-deployment code or state differs from the reviewed plan', async () => {
    const c = connection(), p = await planVaultUpgrade(owner(c), newWasm, sha256(oldWasm));
    c.provider.sendTransactionUntil.mockImplementationOnce(async () => terminal());
    await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), await directory())).rejects.toThrow('UPGRADE_POST_CODE_MISMATCH');
    c.provider.sendTransactionUntil.mockImplementationOnce(async () => { code = Buffer.from(newWasm); values[0]!.value = 'Y2hhbmdlZA=='; return terminal(); });
    await expect(executeVaultUpgrade(owner(c), p, newWasm, upgradePlanHash(p), await directory())).rejects.toThrow('UPGRADE_POST_STATE_CHANGED');
  });
  it('fingerprints state canonically and rejects duplicate storage keys', () => {
    const rows = [{ key: 'YQ==', value: '' }, { key: 'Yg==', value: 'YQ==' }];
    expect(upgradeStateFingerprint(rows)).toBe(upgradeStateFingerprint([...rows].reverse()));
    expect(() => upgradeStateFingerprint([rows[0], rows[0]])).toThrow('UPGRADE_INVALID_STATE');
  });
});
