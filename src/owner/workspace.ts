import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { attestEndpoint } from '../core/private-client.js';
import { canonical, sha256 } from '../core/crypto.js';
import { readVault } from '../core/near.js';
import { commandSchema } from '../core/private-protocol.js';
import { chainPolicySchema, hashHex, nearAccount } from '../core/wire.js';
import type { AuditExport } from '../core/types.js';
import { connectOwner, transactionOutcome, writePrivateJson } from './account.js';
import { downloadPrivateAudit, openPrivateReceipt, ownerRuntimeSchema, runPrivateJob, sendPrivate, verifyPrivateAudit, type PrivateJob } from './private.js';
import { executeTransactionPlan, makeTransactionPlan, planHash, plannedCall, transactionPlanSchema } from './transactions.js';
import { ScheduleStore } from './scheduler.js';
import { allowlistChangeSchema, changeAllowlists, ownerAllowlists, ownerOpeningsSchema, type OwnerAllowlists } from './policy.js';
export { ownerOpeningsSchema } from './policy.js';

const uuid = z.string().uuid();
export const ownerMissionSchema = z.object({
  id: uuid, type: z.enum(['research', 'prepare']), prompt: z.string().trim().min(5).max(1600),
  amount: z.string().optional(), kind: z.enum(['allocation-reserve', 'private-payment']).default('allocation-reserve'),
  counterparty: z.string().max(60).optional(),
  research: z.object({ stablecoinsOnly: z.boolean(), allowBridgedAssets: z.boolean(), minimumLiquidityUsd: z.number().min(0).max(1e12) }).strict(),
}).strict();
export interface OwnerPlan { hash: string; plan: z.infer<typeof transactionPlanSchema>; call: ReturnType<typeof plannedCall> }
export interface OwnerState {
  configured: boolean; network: 'testnet' | 'mainnet'; vault: string;
  endpoint?: string; executorPublicKey?: string; signerConfigured: boolean;
  chain?: Awaited<ReturnType<typeof readVault>>; chainError?: string;
  counterparties: { name: string; recipient: string }[];
  allowlists?: OwnerAllowlists;
  jobs: { id: string; type: string; state: string }[];
  plans: { hash: string; kind: string; network: string }[];
  schedules: { id: string; type: string; state: string; runs: number; maxRuns: number; nextRunAt: string; errorCode?: string }[];
}
async function optionalJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Local owner boundary: fixed private paths, no credentials in browser responses. */
export class OwnerWorkspace {
  readonly directory: string;
  readonly schedules: ScheduleStore;
  constructor(directory = resolve('.private/tee'), private credentials = process.env.NESLOS_OWNER_CREDENTIALS_FILE) {
    this.directory = resolve(directory);
    this.schedules = new ScheduleStore(join(this.directory, 'schedules'), async (command, configHash) => {
      const config = await this.config();
      if (sha256(canonical(config)) !== configHash) throw new Error('SCHEDULE_CONFIG_CHANGED');
      const job = await runPrivateJob(config, await this.token(), command, this.path('jobs/' + command.id + '.json'));
      const status = (job.result as { status?: string } | undefined)?.status;
      return { stop: command.type === 'observe' && !!status && !['pending-dispatch', 'pending-settlement'].includes(status) };
    });
  }
  private path(name: string) { return join(this.directory, name); }
  private async config() { return ownerRuntimeSchema.parse(await optionalJson(this.path('runtime.json'))); }
  private async token() { return z.object({ token: hashHex }).parse(await optionalJson(this.path('owner-token.json'))).token; }
  private async openings() {
    const value = await optionalJson(this.path('openings.json'));
    if (!value) throw new Error('OWNER_OPENINGS_REQUIRED: create private venue and recipient openings with the setup command.');
    return ownerOpeningsSchema.parse(value);
  }
  private async files(folder: string, pattern: RegExp) {
    try { return (await readdir(this.path(folder))).filter(name => pattern.test(name)).sort().slice(-1000); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async state(): Promise<OwnerState> {
    const raw = await optionalJson(this.path('runtime.json'));
    const config = raw === undefined ? undefined : ownerRuntimeSchema.parse(raw);
    const state: OwnerState = { configured: !!config, network: config?.network ?? 'testnet', vault: config?.vault ?? 'vault.neslos.testnet',
      endpoint: config?.endpoint, executorPublicKey: config?.executorPublicKey, signerConfigured: !!this.credentials, counterparties: [], jobs: [], plans: [], schedules: [] };
    const openings = await optionalJson(this.path('openings.json'));
    if (openings) state.counterparties = ownerOpeningsSchema.parse(openings).counterparties.map(({ name, recipient }) => ({ name, recipient }));
    try { state.chain = await readVault(state.vault, state.network); } catch { state.chainError = 'Finalized vault state is unavailable. Refresh before reviewing a transaction.'; }
    if (openings && state.chain) state.allowlists = ownerAllowlists(state.chain.config.policy, ownerOpeningsSchema.parse(openings));
    for (const file of await this.files('jobs', /^[a-f0-9-]{36}\.json$/)) {
      const job = await this.job(file.slice(0, -5)); state.jobs.push({ id: job.command.id, type: job.command.type, state: job.state });
    }
    for (const file of await this.files('plans', /^[a-f0-9]{64}\.json$/)) {
      const { hash, plan } = await this.plan(file.slice(0, -5)); state.plans.push({ hash, kind: plan.operation.kind, network: plan.config.network });
    }
    state.schedules = (await this.schedules.list()).map(s => ({ id: s.id, type: s.command.type, state: s.state, runs: s.runs, maxRuns: s.maxRuns, nextRunAt: s.nextRunAt, errorCode: s.errorCode }));
    return state;
  }
  async attest() { const c = await this.config(); return (await attestEndpoint(c.endpoint, c.teePolicy, c.executorPublicKey)).identity; }
  async status() { return sendPrivate(await this.config(), await this.token(), { type: 'status', id: randomUUID() }); }
  private async missionCommand(input: unknown) {
    const mission = ownerMissionSchema.parse(input), openings = await this.openings();
    const counterparty = openings.counterparties.find(c => c.name === mission.counterparty);
    return commandSchema.parse({ type: mission.type, id: mission.id, prompt: mission.prompt, venues: openings.venues, research: mission.research,
      ...(mission.type === 'prepare' ? { amount: mission.amount, kind: mission.kind, counterparty: counterparty ? { recipient: counterparty.recipient, salt: counterparty.salt } : undefined } : {}) });
  }
  async execute(input: unknown) {
    const command = await this.missionCommand(input);
    return runPrivateJob(await this.config(), await this.token(), command, this.path('jobs/' + command.id + '.json'));
  }
  async schedule(input: unknown) {
    const request = z.object({ mission: ownerMissionSchema.optional(), jobId: uuid.optional(), intervalSeconds: z.number().int().min(300).max(604800), maxRuns: z.number().int().min(1).max(12) }).strict().parse(input);
    if (!!request.mission === !!request.jobId) throw new Error('SCHEDULE_INPUT');
    let command;
    if (request.mission) {
      if (request.mission.type !== 'research') throw new Error('SCHEDULE_RESEARCH_ONLY');
      command = await this.missionCommand(request.mission);
    } else {
      const job = await this.job(request.jobId!);
      const authorizationHash = z.object({ signed: z.object({ hash: hashHex }) }).parse(job.result).signed.hash;
      command = commandSchema.parse({ type: 'observe', id: randomUUID(), authorizationHash });
    }
    return this.schedules.create({ format: 'neslos-schedule-v1', id: randomUUID(), configHash: sha256(canonical(await this.config())), command, intervalSeconds: request.intervalSeconds, maxRuns: request.maxRuns, runs: 0, state: 'active', nextRunAt: new Date(Date.now() + request.intervalSeconds * 1000).toISOString() });
  }
  async job(id: string): Promise<PrivateJob> {
    uuid.parse(id); const value = await optionalJson(this.path('jobs/' + id + '.json')) as PrivateJob | undefined;
    if (!value || value.format !== 'neslos-private-job-v1' || value.command.id !== id || !['prepared', 'complete'].includes(value.state)) throw new Error('JOB_NOT_FOUND');
    commandSchema.parse(value.command); return value;
  }
  async retry(id: string) { const job = await this.job(id); return runPrivateJob(await this.config(), await this.token(), job.command, this.path('jobs/' + id + '.json')); }
  async observe(id: string) {
    const job = await this.job(id);
    const hash = z.object({ signed: z.object({ hash: hashHex }) }).parse(job.result).signed.hash;
    const command = { type: 'observe' as const, id: randomUUID(), authorizationHash: hash };
    return runPrivateJob(await this.config(), await this.token(), command, this.path('jobs/' + command.id + '.json'));
  }
  async createPlan(operation?: unknown, jobId?: string, expectedVersion?: string): Promise<OwnerPlan> {
    const config = await this.config();
    const plan = await makeTransactionPlan(config, operation, jobId ? await this.job(jobId) : undefined, expectedVersion), hash = planHash(plan);
    const existing = await optionalJson(this.path('plans/' + hash + '.json'));
    if (existing === undefined) await writePrivateJson(this.path('plans/' + hash + '.json'), plan, true);
    return { hash, plan, call: plannedCall(plan) };
  }
  async policyPlan(input: unknown) {
    const changes = z.object({ dailyLimit: z.string(), perActionLimit: z.string(), maxSlippageBps: z.number().int(), requireConfidential: z.boolean(), outputAssets: z.array(z.string()).min(1).max(16), ...allowlistChangeSchema.shape }).strict().parse(input);
    const config = await this.config(), state = await readVault(config.vault, config.network);
    const allowlists = changes.allowedVenues !== undefined || changes.allowedCounterparties !== undefined
      ? changeAllowlists(state.config.policy, await this.openings(), { allowedVenues: changes.allowedVenues, allowedCounterparties: changes.allowedCounterparties }) : {};
    const policy = chainPolicySchema.parse({ ...state.config.policy, ...allowlists, daily_limit: changes.dailyLimit, per_action_limit: changes.perActionLimit, max_slippage_bps: changes.maxSlippageBps, require_confidential: changes.requireConfidential, output_assets: changes.outputAssets });
    if (BigInt(policy.daily_limit) === 0n || BigInt(policy.per_action_limit) === 0n || BigInt(policy.per_action_limit) > BigInt(policy.daily_limit)) throw new Error('POLICY_LIMITS');
    return this.createPlan({ kind: 'policy', policy }, undefined, state.config.policy_version);
  }
  async plan(hash: string): Promise<OwnerPlan> {
    hashHex.parse(hash); const plan = transactionPlanSchema.parse(await optionalJson(this.path('plans/' + hash + '.json')));
    if (planHash(plan) !== hash) throw new Error('PLAN_HASH');
    return { hash, plan, call: plannedCall(plan) };
  }
  async submit(hash: string, approvedHash: string, allowMainnet: boolean) {
    const { plan } = await this.plan(hash);
    if (hash !== approvedHash) throw new Error('PLAN_APPROVAL_HASH');
    if (!this.credentials) throw new Error('OWNER_SIGNER_UNAVAILABLE: configure the local owner credential file first.');
    const owner = await connectOwner(plan.config.network, this.credentials);
    const result = await executeTransactionPlan(owner, plan, approvedHash, this.path('transactions'), allowMainnet);
    return { hash: result.hash, ...transactionOutcome(result.outcome), explorer: `https://${plan.config.network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${result.hash}` };
  }
  async audit() {
    const config = await this.config(), previous = await optionalJson(this.path('audit.json')) as AuditExport | undefined;
    if (previous) verifyPrivateAudit(previous, config);
    const bundle = await downloadPrivateAudit(config, await this.token(), previous?.checkpoint);
    await writePrivateJson(this.path('audit.json'), bundle); return bundle;
  }
  async openReceipt(id: string) { uuid.parse(id); return openPrivateReceipt(await this.config(), await this.token(), await optionalJson(this.path('audit.json')) as AuditExport, id); }
}
