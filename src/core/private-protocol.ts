import { z } from 'zod';
import { units } from './amounts.js';
import { hashHex, nearAccount } from './wire.js';

const amount = z.string().max(39).refine(v => { try { return units(v) > 0n; } catch { return false; } });
const opening = z.object({ name: z.enum(['near-intents', 'rhea-lending', 'rhea-dex', 'meta-pool', 'linear']), salt: hashHex }).strict();
const researchFields = {
  id: z.string().uuid(), prompt: z.string().min(5).max(1600),
  venues: z.array(opening).min(1).max(16),
  research: z.object({ stablecoinsOnly: z.boolean(), allowBridgedAssets: z.boolean(), minimumLiquidityUsd: z.number().finite().min(0).max(1e12) }).strict(),
};
export const prepareSchema = z.object({
  type: z.literal('prepare'), ...researchFields, amount, kind: z.enum(['private-payment', 'allocation-reserve']),
  counterparty: z.object({ recipient: nearAccount, salt: hashHex }).strict(),
}).strict();
export const researchCommandSchema = z.object({ type: z.literal('research'), ...researchFields }).strict();
export const observeSchema = z.object({ type: z.literal('observe'), id: z.string().uuid(), authorizationHash: hashHex }).strict();
export const auditExportSchema = z.object({ type: z.literal('audit-export'), id: z.string().uuid(), offset: z.number().int().min(0).max(128_001_000).default(0), checkpoint: hashHex.optional() }).strict();
export const auditOpenSchema = z.object({ type: z.literal('audit-open'), id: z.string().uuid(), entryId: z.string().uuid(), entryHash: hashHex }).strict();
export const runtimeStatusSchema = z.object({ type: z.literal('status'), id: z.string().uuid() }).strict();
export const commandSchema = z.discriminatedUnion('type', [prepareSchema, researchCommandSchema, observeSchema, auditExportSchema, auditOpenSchema, runtimeStatusSchema]);
export type PrivateCommand = z.infer<typeof commandSchema>;
