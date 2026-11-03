import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectOwner, json, writePrivateJson } from '../src/owner/account.js';
import { deployTestnet, makeTestnetPlan, testnetPlanSchema } from '../src/owner/testnet.js';
import { proveTestnet } from '../src/owner/proof.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  credentials: { type: 'string', default: resolve(process.env.NESLOS_SOURCE_ROOT ?? '.', '.private/near/testnet/neslos.testnet.json') }, 'private-dir': { type: 'string', default: '.private/testnet' },
} });
const command = positionals[0];
if (!command || !['status', 'plan', 'deploy', 'prove'].includes(command) || !values.credentials) {
  console.log('Usage: npm run testnet -- <status|plan|deploy|prove> --credentials PATH [--private-dir PATH]\nAll commands are fixed to testnet. plan saves exact code hashes and limits before deployment.');
  process.exit(command ? 1 : 0);
}
const owner = await connectOwner('testnet', values.credentials);
const directory = resolve(values['private-dir']);
if (command === 'status') {
  console.log(json({ network: 'testnet', owner: owner.account.accountId, publicKey: owner.publicKey.toString(), state: await owner.account.getState() }));
} else if (command === 'plan') {
  const [vault, token] = await Promise.all([readFile('artifacts/policy_vault.wasm'), readFile('artifacts/neslos_test_token.wasm')]);
  const plan = await makeTestnetPlan(owner, directory + '/executor.json', vault, token);
  await writePrivateJson(directory + '/plan.json', plan);
  console.log(json(plan));
} else {
  const plan = testnetPlanSchema.parse(JSON.parse(await readFile(directory + '/plan.json', 'utf8')));
  let evidence: unknown;
  if (command === 'deploy') {
    const [vault, token] = await Promise.all([readFile('artifacts/policy_vault.wasm'), readFile('artifacts/neslos_test_token.wasm')]);
    evidence = await deployTestnet(owner, plan, { vault, token }, directory + '/transactions');
  } else {
    evidence = await proveTestnet(owner, plan, directory);
  }
  await mkdir('deploy', { recursive: true });
  const file = command === 'deploy' ? 'deploy/testnet.json' : 'deploy/testnet-proof.json';
  await writeFile(file, json(evidence));
  console.log(json(evidence));
  console.log(json({ evidence: file }));
}
