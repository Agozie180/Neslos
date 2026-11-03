import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { actions, baseDecode, baseEncode, KeyPair, nearToYocto, teraToGas } from 'near-api-js';
import { z } from 'zod';
import { commitment, keyFromSeed } from '../core/crypto.js';
import { hashHex, nearAccount, chainPolicySchema } from '../core/wire.js';
import { connectOwner, submitOnce, transactionOutcome, writePrivateJson } from './account.js';
import { isMissingNearAccount } from '../core/near.js';

export const testnetPlanSchema = z.object({
  format: z.literal('neslos-testnet-plan-v1'), network: z.literal('testnet'), owner: nearAccount,
  ownerPublicKey: z.string().startsWith('ed25519:'), vault: nearAccount, token: nearAccount,
  vaultFunding: z.literal('3000000000000000000000000'), tokenFunding: z.literal('2000000000000000000000000'),
  vaultSha256: hashHex, tokenSha256: hashHex, executorPublicKey: hashHex,
  policy: chainPolicySchema, supply: z.literal('1000000000'),
  disclosure: z.literal('Public testnet contract demonstration. Test fixture token; local executor; no TEE or Intents claim.'),
}).strict().superRefine((p, ctx) => {
  if (!p.owner.endsWith('.testnet') || p.vault !== 'vault.' + p.owner || p.token !== 'token.' + p.owner) ctx.addIssue({ code: 'custom', message: 'Use dedicated vault/token children of the testnet owner.' });
  if (p.policy.require_confidential || !p.policy.paused || p.policy.daily_limit !== '500000000' || p.policy.per_action_limit !== '200000000' || p.policy.output_assets.length !== 1 || p.policy.output_assets[0] !== 'nep141:' + p.token) ctx.addIssue({ code: 'custom', message: 'Testnet starts paused with public test-token routing and bounded limits.' });
});
export type TestnetPlan = z.infer<typeof testnetPlanSchema>;
export const artifactHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function loadTestExecutor(path: string) {
  const data = z.object({ testnetOnly: z.literal(true), privateKey: z.string().startsWith('ed25519:'), venueSalt: hashHex, recipientSalt: hashHex }).strict().parse(JSON.parse(await readFile(path, 'utf8')));
  const key = KeyPair.fromString(data.privateKey as `ed25519:${string}`);
  const publicKey = Buffer.from(baseDecode(key.getPublicKey().toString().slice(8))).toString('hex');
  const signing = keyFromSeed(baseDecode(data.privateKey.slice(8)).subarray(0, 32));
  return { ...data, publicKey, signingKey: signing.privateKey };
}

export async function makeTestnetPlan(owner: Awaited<ReturnType<typeof connectOwner>>, executorFile: string, vaultWasm: Uint8Array, tokenWasm: Uint8Array): Promise<TestnetPlan> {
  if (owner.network !== 'testnet') throw new Error('TESTNET_ONLY');
  let executor: Awaited<ReturnType<typeof loadTestExecutor>>;
  try { executor = await loadTestExecutor(executorFile); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Official SDK generates the key; the existing signing protocol binds the contract authorization.
    const { randomBytes } = await import('node:crypto');
    await writePrivateJson(executorFile, { testnetOnly: true, privateKey: KeyPair.fromRandom('ed25519').toString(), venueSalt: randomBytes(32).toString('hex'), recipientSalt: randomBytes(32).toString('hex') }, true);
    executor = await loadTestExecutor(executorFile);
  }
  const id = owner.account.accountId, token = 'token.' + id;
  return testnetPlanSchema.parse({
    format: 'neslos-testnet-plan-v1', network: 'testnet', owner: id, ownerPublicKey: owner.publicKey.toString(),
    vault: 'vault.' + id, token, vaultFunding: nearToYocto('3').toString(), tokenFunding: nearToYocto('2').toString(),
    vaultSha256: artifactHash(vaultWasm), tokenSha256: artifactHash(tokenWasm), executorPublicKey: executor.publicKey,
    policy: { daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, max_quote_age_ms: '60000',
      venue_commitments: [commitment('venue', 'testnet-direct-transfer', executor.venueSalt)],
      counterparty_commitments: [commitment('counterparty', id, executor.recipientSalt)],
      output_assets: ['nep141:' + token], require_confidential: false, paused: true }, supply: '1000000000',
    disclosure: 'Public testnet contract demonstration. Test fixture token; local executor; no TEE or Intents claim.',
  });
}

export async function deployTestnet(owner: Awaited<ReturnType<typeof connectOwner>>, input: unknown, wasm: { vault: Uint8Array; token: Uint8Array }, journalDir: string) {
  const p = testnetPlanSchema.parse(input);
  if (owner.network !== 'testnet' || owner.account.accountId !== p.owner || owner.publicKey.toString() !== p.ownerPublicKey) throw new Error('DEPLOYMENT_OWNER_MISMATCH');
  if (artifactHash(wasm.vault) !== p.vaultSha256 || artifactHash(wasm.token) !== p.tokenSha256) throw new Error('DEPLOYMENT_CODE_CHANGED: regenerate and review the plan.');
  const outcomes = [];
  const targets = [
    { id: p.token, code: wasm.token, amount: p.tokenFunding, args: { holder: p.vault, registered: [p.owner], supply: p.supply } },
    { id: p.vault, code: wasm.vault, amount: p.vaultFunding, args: { owner_id: p.owner, token_id: p.token, network: 'testnet', executor_public_key: p.executorPublicKey, policy: p.policy } },
  ];
  for (const target of targets) {
    let exists = false;
    try {
      const current = await owner.provider.viewAccount({ accountId: target.id, blockQuery: { finality: 'final' } });
      exists = true;
      if (current.code_hash !== baseEncode(createHash('sha256').update(target.code).digest())) throw new Error('EXISTING_CONTRACT_MISMATCH: ' + target.id);
      const keys = await owner.provider.viewAccessKeyList({ accountId: target.id, finalityQuery: { finality: 'final' } });
      if (keys.keys.length !== 1 || keys.keys[0]?.public_key !== p.ownerPublicKey || keys.keys[0]?.access_key.permission !== 'FullAccess') throw new Error('EXISTING_ACCESS_KEYS_MISMATCH: ' + target.id);
    } catch (error) {
      // A network failure is never interpreted as permission to create/fund again.
      if (!isMissingNearAccount(error, target.id)) throw error;
    }
    if (exists) {
      let hash: string | undefined;
      try {
        const saved = JSON.parse(await readFile(journalDir + '/deploy-' + target.id + '.json', 'utf8')) as { hash: string };
        const observed = await owner.provider.viewTransactionStatus({ txHash: saved.hash, accountId: p.owner, waitUntil: 'FINAL' });
        if (!transactionOutcome(observed).success || !transactionOutcome(observed).final) throw new Error('DEPLOYMENT_NOT_FINAL');
        hash = saved.hash;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      outcomes.push({ account: target.id, reused: true, ...(hash ? { transactionHash: hash, explorer: 'https://testnet.nearblocks.io/txns/' + hash } : {}) });
      continue;
    }
    const state = await owner.account.getState();
    if (state.balance.available < BigInt(target.amount) + nearToYocto('1')) throw new Error('OWNER_RESERVE: keep at least 1 testnet NEAR available after funding.');
    const receipt = await submitOnce(owner.account, 'testnet', journalDir + '/deploy-' + target.id + '.json', target.id, [
      actions.createAccount(), actions.transfer(BigInt(target.amount)), actions.addFullAccessKey(owner.publicKey),
      actions.deployContract(target.code), actions.functionCall('new', target.args, teraToGas('50'), 0n),
    ]);
    if (!transactionOutcome(receipt.outcome).success) throw new Error('DEPLOYMENT_FAILED: inspect transaction ' + receipt.hash);
    outcomes.push({ account: target.id, transactionHash: receipt.hash, explorer: 'https://testnet.nearblocks.io/txns/' + receipt.hash });
  }
  const config = await owner.provider.callFunction({ contractId: p.vault, method: 'get_config', args: {}, blockQuery: { finality: 'final' } });
  const validated = (await import('../core/wire.js')).vaultConfigSchema.parse(config);
  if (validated.owner_id !== p.owner || validated.token_id !== p.token || validated.network !== 'testnet' || validated.executor_public_key !== p.executorPublicKey) throw new Error('DEPLOYED_CONFIG_MISMATCH');
  const code = await Promise.all(targets.map(async target => {
    const deployed = await owner.provider.viewContractCode({ contractId: target.id, blockQuery: { finality: 'final' } });
    if (artifactHash(deployed.code) !== artifactHash(target.code)) throw new Error('DEPLOYED_CODE_MISMATCH');
    return { account: target.id, sha256: artifactHash(deployed.code), chainCodeHash: deployed.hash, blockHash: deployed.block_hash };
  }));
  return { format: 'neslos-testnet-deployment-v1', network: 'testnet', owner: p.owner, vault: p.vault, token: p.token, outcomes, config, code, vaultSha256: p.vaultSha256, tokenSha256: p.tokenSha256, disclosure: p.disclosure, verifiedAt: new Date().toISOString() };
}
