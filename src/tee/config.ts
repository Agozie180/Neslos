import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { teePolicySchema } from '../core/attestation.js';
import { inferencePolicySchema } from '../core/inference.js';
import { hashHex, nearAccount } from '../core/wire.js';

export async function loadRuntimeOptions(env: NodeJS.ProcessEnv = process.env) {
  function required(name: string) { if (!env[name]) throw new Error('Missing deployment setting: ' + name); return env[name]!; }
  async function policy(name: string) {
    if (env[name + '_FILE'] && env[name + '_JSON']) throw new Error('Choose FILE or JSON for ' + name);
    return JSON.parse(env[name + '_JSON'] || await readFile(required(name + '_FILE'), 'utf8'));
  }
  return {
    network: z.enum(['mainnet', 'testnet']).parse(required('NESLOS_NETWORK')),
    vault: nearAccount.parse(required('NESLOS_VAULT_ACCOUNT')),
    teePolicy: teePolicySchema.parse(await policy('NESLOS_TEE_POLICY')),
    inferencePolicy: inferencePolicySchema.parse(await policy('NESLOS_INFERENCE_POLICY')),
    ownerToken: hashHex.parse(required('NESLOS_OWNER_TOKEN')), nearAiKey: required('NEARAI_API_KEY'),
    journalPath: env.NESLOS_JOURNAL || '/data/neslos-audit.json', socket: env.NESLOS_DSTACK_SOCKET || '/var/run/dstack.sock',
  };
}
