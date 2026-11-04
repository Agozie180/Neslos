import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { freshChallenge, teePolicySchema, attestationSchema } from '../src/core/attestation.js';
import { attestEndpoint } from '../src/core/private-client.js';
import { fetchJson } from '../src/core/research.js';
import { hashHex } from '../src/core/wire.js';
import type { AuditExport } from '../src/core/types.js';
import { connectOwner, json, transactionOutcome, writePrivateJson } from '../src/owner/account.js';
import { downloadPrivateAudit, openPrivateReceipt, ownerRuntimeSchema, runPrivateJob, verifyPrivateAudit, type PrivateJob } from '../src/owner/private.js';
import { executeTransactionPlan, makeTransactionPlan, planHash, plannedCall, transactionPlanSchema } from '../src/owner/transactions.js';
import { ownerOpeningsSchema } from '../src/owner/workspace.js';
import { commitment } from '../src/core/crypto.js';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string', default: '.private/tee/runtime.json' }, 'token-file': { type: 'string', default: '.private/tee/owner-token.json' },
  endpoint: { type: 'string' }, 'tee-policy': { type: 'string' }, network: { type: 'string' }, vault: { type: 'string' },
  request: { type: 'string' }, out: { type: 'string' }, audit: { type: 'string' }, entry: { type: 'string' }, job: { type: 'string' },
  plan: { type: 'string' }, credentials: { type: 'string' }, 'approve-hash': { type: 'string' }, 'allow-mainnet': { type: 'boolean', default: false },
  'journal-dir': { type: 'string', default: '.private/tee/transactions' },
} });
function required(key: keyof typeof v): string { const value = v[key]; if (typeof value !== 'string' || !value) throw new Error('Required option: --' + key); return value; }
const readJson = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8'));
const loadConfig = async () => ownerRuntimeSchema.parse(await readJson(v.config));
const loadToken = async () => hashHex.parse((await readJson(v['token-file'])).token);
const save = async (value: unknown, exclusive = false) => { const path = required('out'); await writePrivateJson(path, value, exclusive); console.log(json({ saved: resolve(path) })); };
async function main() {
  switch (positionals[0]) {
    case 'new-token': await save({ token: randomBytes(32).toString('hex') }, true); break;
    case 'openings': {
      const contacts = z.object({ venues: z.array(z.string()).min(1), counterparties: z.array(z.object({ name: z.string(), recipient: z.string() }).strict()).max(32) }).strict().parse(await readJson(required('request')));
      const openings = ownerOpeningsSchema.parse({ venues: contacts.venues.map(name => ({ name, salt: randomBytes(32).toString('hex') })), counterparties: contacts.counterparties.map(c => ({ ...c, salt: randomBytes(32).toString('hex') })) });
      await save(openings, true);
      console.log(json({ venue_commitments: openings.venues.map(v => commitment('venue', v.name, v.salt)), counterparty_commitments: openings.counterparties.map(c => commitment('counterparty', c.recipient, c.salt)), note: 'Private openings saved. Review these commitments in an owner policy plan before use.' })); break;
    }
    case 'evidence': {
      const endpoint = new URL(required('endpoint'));
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Plain HTTPS endpoint required.');
      const nonce = freshChallenge(), evidence = attestationSchema.parse(await fetchJson(endpoint.toString().replace(/\/$/, '') + '/attestation/' + nonce, {}, 700_000));
      if (evidence.nonce !== nonce) throw new Error('ATTESTATION_NONCE');
      await save({ verified: false, warning: 'Collected evidence only. Approve measurements independently, then use init/attest.', requestedAt: new Date().toISOString(), nonce, evidence }); break;
    }
    case 'init': {
      const policy = teePolicySchema.parse(await readJson(required('tee-policy')));
      const verified = await attestEndpoint(required('endpoint'), policy);
      const config = ownerRuntimeSchema.parse({ format: 'neslos-owner-runtime-v1', endpoint: required('endpoint'), teePolicy: policy, executorPublicKey: verified.identity.executorPublicKey, network: required('network'), vault: required('vault') });
      await save(config, true); console.log(json({ identity: verified.identity, note: 'Identity verified; the on-chain executor key is not changed by init.' })); break;
    }
    case 'attest': {
      const config = await loadConfig(), result = await attestEndpoint(config.endpoint, config.teePolicy, config.executorPublicKey);
      await save(result); console.log(json(result.identity)); break;
    }
    case 'state': {
      const config = await loadConfig(); const { readVault } = await import('../src/core/near.js');
      console.log(json(await readVault(config.vault, config.network))); break;
    }
    case 'execute': {
      const result = await runPrivateJob(await loadConfig(), await loadToken(), z.record(z.string(), z.unknown()).parse(await readJson(required('request'))), required('out'));
      console.log(json({ saved: resolve(required('out')), state: result.state, commandId: result.command.id, type: result.command.type })); break;
    }
    case 'audit-export': {
      const config = await loadConfig(); let checkpoint: string | undefined;
      try { const previous = await readJson(required('out')) as AuditExport; verifyPrivateAudit(previous, config); checkpoint = previous.checkpoint; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const bundle = await downloadPrivateAudit(config, await loadToken(), checkpoint);
      await save(bundle); console.log(json({ verifiedEntries: bundle.entries.length, checkpoint: bundle.checkpoint })); break;
    }
    case 'audit-open': await save(await openPrivateReceipt(await loadConfig(), await loadToken(), await readJson(required('audit')), required('entry'))); break;
    case 'verify-audit': console.log(json(verifyPrivateAudit(await readJson(required('audit')), await loadConfig()))); break;
    case 'plan': {
      if (!!v.job === !!v.request) throw new Error('Provide exactly one of --job or --request.');
      const plan = await makeTransactionPlan(await loadConfig(), v.request ? await readJson(v.request) : undefined, v.job ? await readJson(v.job) as PrivateJob : undefined);
      await save(plan, true); console.log(json({ approveHash: planHash(plan), network: plan.config.network, owner: plan.owner, call: plannedCall(plan), note: 'Review this exact call. No transaction has been signed or sent.' })); break;
    }
    case 'submit': {
      const plan = transactionPlanSchema.parse(await readJson(required('plan')));
      // Reject accidental opt-in before opening owner credentials or reading RPC state.
      if (required('approve-hash') !== planHash(plan)) throw new Error('PLAN_APPROVAL_HASH');
      if (plan.config.network === 'mainnet' && !v['allow-mainnet']) throw new Error('MAINNET_OPT_IN_REQUIRED');
      const owner = await connectOwner(plan.config.network, required('credentials'));
      const record = await executeTransactionPlan(owner, plan, required('approve-hash'), v['journal-dir'], v['allow-mainnet']);
      console.log(json({ transactionHash: record.hash, ...transactionOutcome(record.outcome), explorer: `https://${plan.config.network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${record.hash}` })); break;
    }
    default:
      console.log('Usage: npm run private -- <new-token|openings|evidence|init|attest|state|execute|audit-export|audit-open|verify-audit|plan|submit> [options]\nSee docs/TEE-RUNBOOK.md for the complete command sequence. Secrets are read from private files, never command-line values.');
      if (positionals[0]) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error instanceof z.ZodError ? 'Invalid private input schema. Check the runbook; input values omitted.' : error instanceof Error ? error.message : 'Private owner operation failed.'); process.exitCode = 1; });
