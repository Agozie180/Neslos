import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { teePolicySchema } from '../core/attestation.js';
import { verifyAudit } from '../core/audit.js';
import { canonical, sha256, verifyHash } from '../core/crypto.js';
import { privateCommand } from '../core/private-client.js';
import { HttpResponseError } from '../core/research.js';
import { commandSchema, type PrivateCommand } from '../core/private-protocol.js';
import type { AuditExport } from '../core/types.js';
import { hashHex, nearAccount } from '../core/wire.js';
import { writePrivateJson } from './account.js';

export const ownerRuntimeSchema = z.object({
  format: z.literal('neslos-owner-runtime-v1'), endpoint: z.url().refine(v => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }),
  network: z.enum(['testnet', 'mainnet']), vault: nearAccount, executorPublicKey: hashHex, teePolicy: teePolicySchema,
}).strict();
export type OwnerRuntime = z.infer<typeof ownerRuntimeSchema>;
const replySchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: z.unknown() }).strict(), z.object({ ok: z.literal(false), error: z.string() }).strict()]);
export async function sendPrivate(config: OwnerRuntime, ownerToken: string, command: PrivateCommand) {
  ownerRuntimeSchema.parse(config); commandSchema.parse(command);
  const reply = replySchema.parse(await privateCommand(config.endpoint, config.teePolicy, ownerToken, command, config.executorPublicKey));
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
export interface PrivateJob {
  format: 'neslos-private-job-v1'; configHash: string; command: PrivateCommand;
  state: 'prepared' | 'complete'; result?: unknown;
}
/** Persist the request ID before any network call. A timeout retries the exact command. */
export async function runPrivateJob(config: OwnerRuntime, ownerToken: string, input: Record<string, unknown>, path: string): Promise<PrivateJob> {
  ownerRuntimeSchema.parse(config);
  let previous: PrivateJob | undefined;
  try { previous = JSON.parse(await readFile(path, 'utf8')) as PrivateJob; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const command = commandSchema.parse({ ...input, id: input.id ?? previous?.command.id ?? randomUUID() });
  if (command.type === 'audit-export' || command.type === 'audit-open') throw new Error('Use the dedicated audit commands.');
  const configHash = sha256(canonical(config));
  if (previous && (previous.format !== 'neslos-private-job-v1' || previous.configHash !== configHash || canonical(previous.command) !== canonical(command))) throw new Error('PRIVATE_JOB_CONFLICT');
  if (previous?.state === 'complete') return previous;
  const job: PrivateJob = { format: 'neslos-private-job-v1', configHash, command, state: 'prepared' };
  if (!previous) await writePrivateJson(path, job, true);
  const result = await sendPrivate(config, ownerToken, command);
  const completed: PrivateJob = { ...job, state: 'complete', result };
  await writePrivateJson(path, completed);
  return completed;
}

const pageSchema = z.object({ checkpoint: hashHex, offset: z.number().int().min(0), totalBytes: z.number().int().min(1).max(32_000_000), chunk: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(180_000), nextOffset: z.number().int().positive().nullable() }).strict();
export function verifyPrivateAudit(bundle: AuditExport, config: OwnerRuntime, retainedCheckpoint?: string) {
  if (bundle.scope !== 'attested-executor' || bundle.entries.some(e => e.mode !== 'attested')) throw new Error('AUDIT_SCOPE');
  const result = verifyAudit(bundle, config.executorPublicKey, retainedCheckpoint);
  if (!result.valid) throw new Error('AUDIT_VERIFICATION: ' + result.reason);
  return result;
}
export async function downloadPrivateAudit(config: OwnerRuntime, token: string, retainedCheckpoint?: string): Promise<AuditExport> {
  let offset = 0, checkpoint: string | undefined, total: number | undefined;
  const chunks: Buffer[] = [];
  for (let page = 0; page < 251; page++) {
    const command: PrivateCommand = { type: 'audit-export', id: randomUUID(), offset, ...(checkpoint ? { checkpoint } : {}) };
    let raw: unknown;
    for (let attempt = 0; ; attempt++) {
      try { raw = await sendPrivate(config, token, command); break; }
      catch (error) {
        if (!(error instanceof HttpResponseError) || error.status !== 429 || attempt >= 2) throw error;
        // Large archives span rate windows. Retry the same snapshot page with a fresh attestation.
        await delay(Math.min(60_000, Math.max(1000, error.retryAfterMs ?? 60_000)));
      }
    }
    const result = pageSchema.parse(raw);
    const bytes = Buffer.from(result.chunk, 'base64');
    if (bytes.length === 0 || bytes.length > 128_000 || result.offset !== offset || (checkpoint && result.checkpoint !== checkpoint) || (total !== undefined && result.totalBytes !== total)) throw new Error('AUDIT_PAGE_BINDING');
    checkpoint = result.checkpoint; total = result.totalBytes; offset += bytes.length; chunks.push(bytes);
    if (offset > total || result.nextOffset !== (offset < total ? offset : null)) throw new Error('AUDIT_PAGE_ORDER');
    if (result.nextOffset === null) {
      const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AuditExport;
      if (bundle.checkpoint !== checkpoint) throw new Error('AUDIT_CHECKPOINT');
      verifyPrivateAudit(bundle, config, retainedCheckpoint);
      return bundle;
    }
  }
  throw new Error('AUDIT_PAGE_LIMIT');
}
export async function openPrivateReceipt(config: OwnerRuntime, token: string, bundle: AuditExport, entryId: string) {
  verifyPrivateAudit(bundle, config);
  const entry = bundle.entries.find(e => e.id === entryId);
  if (!entry) throw new Error('AUDIT_ENTRY_ABSENT');
  const result = z.object({ value: z.unknown(), opening: z.object({ domain: z.literal('neslos:audit-opening:v1'), entryHash: hashHex, valueHash: hashHex }).strict(), signature: z.string().regex(/^[a-f0-9]{128}$/) }).strict().parse(await sendPrivate(config, token, { type: 'audit-open', id: randomUUID(), entryId, entryHash: entry.hash }));
  if (result.opening.entryHash !== entry.hash || result.opening.valueHash !== sha256(canonical(result.value)) || !verifyHash(sha256(canonical(result.opening)), result.signature, config.executorPublicKey)) throw new Error('AUDIT_OPENING_SIGNATURE');
  return { ...result, executorPublicKey: config.executorPublicKey, checkpoint: bundle.checkpoint };
}
