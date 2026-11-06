import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { connectOwner, json, writePrivateJson } from '../src/owner/account.js';
import { executeVaultUpgrade, inspectVaultUpgrade, planVaultUpgrade, upgradePlanHash, upgradePlanSchema, EXISTING_VAULT_SHA256 } from '../src/owner/upgrade.js';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
  credentials: { type: 'string' }, wasm: { type: 'string', default: 'artifacts/policy_vault.wasm' },
  plan: { type: 'string' }, out: { type: 'string' }, 'approve-hash': { type: 'string' },
  'expected-old-sha256': { type: 'string', default: EXISTING_VAULT_SHA256 },
  'journal-dir': { type: 'string', default: '.private/testnet/upgrade-transactions' },
} });
const required = (name: keyof typeof v) => { const value = v[name]; if (typeof value !== 'string' || !value) throw new Error('Required option: --' + name); return value; };
async function main() {
  const command = positionals[0];
  if (!command || !['inspect', 'plan', 'execute'].includes(command)) {
    console.log('Usage: node --import tsx scripts/upgrade.ts <inspect|plan|execute> --credentials FILE [--wasm FILE] [--plan FILE --approve-hash HASH] [--out FILE]\nFixed to existing paused vault.neslos.testnet. Deployment contains only DeployContract.');
    if (command) process.exitCode = 1; return;
  }
  const owner = await connectOwner('testnet', required('credentials'));
  if (command === 'inspect') { console.log(json(await inspectVaultUpgrade(owner))); return; }
  const wasm = await readFile(resolve(v.wasm));
  if (command === 'plan') {
    const plan = await planVaultUpgrade(owner, wasm, v['expected-old-sha256']);
    const out = required('out'); await writePrivateJson(out, plan, true);
    console.log(json({ saved: resolve(out), approveHash: upgradePlanHash(plan), plan })); return;
  }
  const plan = upgradePlanSchema.parse(JSON.parse(await readFile(resolve(required('plan')), 'utf8')));
  const result = await executeVaultUpgrade(owner, plan, wasm, required('approve-hash'), resolve(v['journal-dir']));
  if (v.out) await writePrivateJson(v.out, result, true);
  console.log(json(result));
}
main().catch(error => { console.error(error instanceof z.ZodError ? 'Invalid upgrade input schema; input values omitted.' : error instanceof Error ? error.message : 'Upgrade failed.'); process.exitCode = 1; });
