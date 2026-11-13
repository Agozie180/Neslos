import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const requireValue = (condition, message) => {
  if (!condition) throw new Error(`README_EVIDENCE_INVALID: ${message}`);
};
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function verifyFiles(directory, rows) {
  for (const row of rows) {
    const bytes = await readFile(resolve(root, directory, row.name ?? row.path));
    requireValue(bytes.length === row.bytes, `${directory}/${row.name ?? row.path} byte count`);
    requireValue(sha256(bytes) === row.sha256, `${directory}/${row.name ?? row.path} checksum`);
  }
}

const nodeVersion = (await readFile(resolve(root, '.node-version'), 'utf8')).trim();
const fixture = await readJson('fixtures/rhea-2026-11-01.json');
const vault = await readJson('deploy/testnet-commerce-proof-20261106.json');
const rhea = await readJson('deploy/rhea-funded-cycle-20261112/record.json');
const privateRecord = await readJson('deploy/near-private-research-20261109/record.json');
const privateResearch = await readJson('deploy/near-private-research-20261109/research-proof.json');
const privateRestart = await readJson('deploy/near-private-research-20261109/restart-proof.json');
const vaultRestoration = await readJson('deploy/near-private-research-20261109/vault-restoration.json');
const settlementRecord = await readJson('deploy/confidential-settlement-20261109/record.json');
const settlement = await readJson('deploy/confidential-settlement-20261109/result.json');
const returnReceipt = await readJson('deploy/confidential-settlement-20261109/chain-return.json');

await verifyFiles('deploy/near-private-research-20261109', privateRecord.files);
await verifyFiles('deploy/confidential-settlement-20261109', settlementRecord.artifacts);

const allowed = vault.results.find(row => row.step === 'allowed');
const dailyLimit = vault.results.find(row => row.step === 'daily-limit');
const replay = vault.results.find(row => row.step === 'replay');
requireValue(nodeVersion === '24.22.2', 'Node version pin');
requireValue(fixture.retrievedDate === '2026-11-01', 'reference dataset date');
requireValue(vault.network === 'testnet' && allowed?.success === true, 'testnet vault payment');
requireValue(dailyLimit?.success === false && dailyLimit.expectedFailure === 'DAILY_LIMIT', 'daily-limit rejection');
requireValue(replay?.success === false && replay.expectedFailure === 'NONCE', 'replay rejection');
requireValue(vault.final.config.policy.daily_limit === '500000000', 'rehearsal daily limit');
requireValue(vault.final.config.policy.per_action_limit === '200000000', 'rehearsal action limit');
requireValue(vault.final.config.policy.max_slippage_bps === 50, 'rehearsal slippage limit');
requireValue(rhea.environment.network === 'testnet' && rhea.observations.principalReturned === true, 'Rhea principal return');
requireValue(rhea.plan.supplyAmount === rhea.observations.withdrawTokenTransferAmount, 'Rhea supplied/returned amount');
requireValue(privateRecord.privateResearchVerified === true && privateRecord.researchers === 3, 'private research result');
requireValue(privateResearch.passed === true && privateResearch.researchers.length === 3, 'three signed researchers');
requireValue(privateRestart.passed === true && privateRestart.extraJobRejectedBeforeInference === true, 'restart and budget checks');
requireValue(privateRecord.loadedWeightBytesIndependentlyVerified === false, 'model-weight boundary');
requireValue(vaultRestoration.network === 'testnet' && vaultRestoration.policyVersion === '13' && vaultRestoration.paused === true, 'current restored vault state');
requireValue(settlement.network === 'mainnet' && settlement.settlement.principalNear === '0.001', 'mainnet settlement amount');
requireValue(settlement.settlement.principalRestored === true && returnReceipt.exactNativeReturnReceiptVerified === true, 'mainnet principal return');
requireValue(settlement.costs.statedNativeFeeCapNear === '0.004' && settlement.costs.nativeChargedNear === '0.0071149895375', 'mainnet fee figures');
requireValue(settlement.costs.nativeFeeCapPassed === false && settlement.proofPassed === false, 'mainnet fee-cap failure');
requireValue(settlement.execution.neslosVaultUsed === false && settlement.execution.tdxDeployments === 0, 'separate settlement path');

console.log('README_EVIDENCE ' + JSON.stringify({
  node: nodeVersion,
  rehearsal: { referenceDate: fixture.retrievedDate, dailyUsd: 500, perActionUsd: 200, slippageBps: 50 },
  vault: { network: 'testnet', allowed: true, dailyLimitRejected: true, replayRejected: true, currentPolicyVersion: 13 },
  rhea: { network: 'testnet', suppliedAtomic: rhea.plan.supplyAmount, returnedAtomic: rhea.observations.withdrawTokenTransferAmount, fullyReturned: true },
  privateResearch: { network: 'no-chain', researchers: 3, restartPersistence: true, exhaustedBudgetRejected: true, loadedWeightBytesProven: false, archiveHashes: 'verified' },
  settlement: { network: 'mainnet', principalNear: '0.001', principalReturned: true, feeCapNear: '0.004', chargedNear: '0.0071149895375', feeCapPassed: false, neslosVaultUsed: false, archiveHashes: 'verified' },
}));
