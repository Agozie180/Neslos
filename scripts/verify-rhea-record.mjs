import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { values } = parseArgs({ options: { record: { type: 'string', default: 'deploy/rhea-funded-cycle-20261112/record.json' }, rpc: { type: 'string' } }, strict: true });
const record = JSON.parse(await readFile(resolve(values.record), 'utf8'));
const rpcUrl = values.rpc ?? record.environment?.rpc;
const requiredSteps = {
  'token-storage': [record.identity?.token, 'storage_deposit'],
  'rhea-storage': [record.identity?.rhea, 'storage_deposit'],
  mint: [record.identity?.token, 'mint'],
  supply: [record.identity?.token, 'ft_transfer_call'],
  withdraw: [record.identity?.rhea, 'execute'],
};
const fail = message => { throw new Error('RHEA_EVIDENCE_INVALID: ' + message); };
if (record.format !== 'neslos-rhea-funded-cycle-record-v1' || record.environment?.network !== 'testnet') fail('unexpected record format or network');
if (record.identity?.owner !== 'neslos.testnet' || record.identity?.token !== 'usdc.fakes.testnet' || record.identity?.rhea !== 'contract.1689937928.burrow.testnet') fail('unexpected recorded identities');
if (!/^https:\/\//.test(rpcUrl ?? '')) fail('HTTPS RPC required');
if (record.plan?.supplyAmount !== '100000' || record.observations?.principalReturned !== true || record.observations?.residualUnderlyingAtomicUnits !== '0') fail('principal assertions are missing');

async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'neslos-rhea-evidence', method, params }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) fail(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) fail(`RPC ${method}: ${body.error.message ?? 'error'}`);
  return body.result;
}
const transactions = new Map(record.transactions.map(row => [row.step, row]));
if (transactions.size !== Object.keys(requiredSteps).length) fail('transaction steps are missing or duplicated');
const verified = [];
for (const [step, [receiver, method]] of Object.entries(requiredSteps)) {
  const saved = transactions.get(step);
  if (!saved || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(saved.hash)) fail(`invalid ${step} hash`);
  const outcome = await rpc('tx', [saved.hash, record.identity.owner]);
  const call = outcome.transaction?.actions?.[0]?.FunctionCall;
  if (outcome.final_execution_status !== 'FINAL' || !outcome.status || !Object.hasOwn(outcome.status, 'SuccessValue')) fail(`${step} is not finalized successfully`);
  if (outcome.transaction?.signer_id !== record.identity.owner || outcome.transaction?.receiver_id !== receiver || call?.method_name !== method) fail(`${step} signer, receiver or method mismatch`);
  verified.push({ step, hash: saved.hash, receiver, method });
  const logs = outcome.receipts_outcome.flatMap(row => row.outcome?.logs ?? []);
  if (step === 'supply') {
    const protocolAmount = (BigInt(record.plan.supplyAmount) * 10n ** 12n).toString();
    if (!logs.some(log => log.includes(`Transfer ${record.plan.supplyAmount} from ${record.identity.owner} to ${record.identity.rhea}`)) || !logs.some(log => log.includes('"event":"deposit"') && log.includes(`"amount":"${protocolAmount}"`))) fail('supply transfer/deposit logs mismatch');
  }
  if (step === 'withdraw' && (!logs.some(log => log.includes(`Transfer ${record.observations.withdrawTokenTransferAmount} from ${record.identity.rhea} to ${record.identity.owner}`)) || !logs.some(log => log.includes('"event":"withdraw_succeeded"') && log.includes(`"amount":"${record.observations.afterSupply.protocolBalance}"`)))) fail('withdrawal logs mismatch');
}

for (const name of ['beforeSupply', 'afterSupply', 'afterWithdraw']) {
  const expected = record.observations[name];
  const block = await rpc('block', { block_id: expected.blockHeight });
  if (block.header?.height !== expected.blockHeight) fail(`${name} block is unavailable`);
}

console.log(JSON.stringify({
  ok: true, readOnly: true, network: 'testnet', owner: record.identity.owner,
  planHash: record.plan.approveHash, transactions: verified,
  principal: { supplied: record.plan.supplyAmount, returned: record.observations.withdrawTokenTransferAmount, fullyReturned: true },
  retainedSnapshots: {
    beforeSupply: record.observations.beforeSupply,
    afterSupply: record.observations.afterSupply,
    afterWithdraw: record.observations.afterWithdraw,
    note: 'Snapshot blocks exist; immutable supply and withdrawal amounts are independently matched to finalized receipt logs.',
  },
}, null, 2));
