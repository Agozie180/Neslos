import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical, sha256 } from './crypto.js';

const nanoUsd = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
export const inferenceBudgetSchema = z.object({
  totalLimitNanoUsd: nanoUsd,
  dailyLimitNanoUsd: nanoUsd,
  maxCalls: z.number().int().min(0).max(10000),
  maxInputBytes: z.number().int().min(1000).max(64000).default(24000),
  maxOutputTokens: z.number().int().min(128).max(2000).default(800),
  inputNanoUsdPerToken: nanoUsd,
  outputNanoUsdPerToken: nanoUsd,
}).strict();
export type InferenceBudgetPolicy = z.infer<typeof inferenceBudgetSchema>;
export const DISABLED_INFERENCE_BUDGET: InferenceBudgetPolicy = {
  totalLimitNanoUsd: '0', dailyLimitNanoUsd: '0', maxCalls: 0,
  maxInputBytes: 24000, maxOutputTokens: 800, inputNanoUsdPerToken: '0', outputNanoUsdPerToken: '0',
};
export const inferenceReservationSchema = z.object({
  id: z.string().uuid(), modelId: z.string().min(1).max(100),
  createdAt: z.iso.datetime(), calls: z.number().int().min(1).max(3),
  inputTokensBound: z.number().int().positive(), outputTokensBound: z.number().int().positive(),
  reservedNanoUsd: nanoUsd, requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type InferenceReservation = z.infer<typeof inferenceReservationSchema>;

export function estimateInference(modelId: string, requests: unknown[], policy: InferenceBudgetPolicy): InferenceReservation {
  inferenceBudgetSchema.parse(policy);
  if (policy.maxCalls === 0 || BigInt(policy.totalLimitNanoUsd) === 0n || BigInt(policy.dailyLimitNanoUsd) === 0n) throw new Error('INFERENCE_BUDGET_DISABLED: configure an explicit credit allowance first.');
  const sizes = requests.map(request => Buffer.byteLength(canonical(request)));
  if (sizes.some(size => size > policy.maxInputBytes)) throw new Error('INFERENCE_INPUT_LIMIT: narrow the evidence before calling a model.');
  // UTF-8 bytes bound ordinary text tokens; 4096 extra tokens per call cover chat templates.
  // All requested output tokens are reserved, including reasoning. Unknown outcomes stay charged.
  const inputTokensBound = sizes.reduce((sum, size) => sum + size + 4096, 0);
  const outputTokensBound = requests.length * policy.maxOutputTokens;
  const reservedNanoUsd = (BigInt(inputTokensBound) * BigInt(policy.inputNanoUsdPerToken) + BigInt(outputTokensBound) * BigInt(policy.outputNanoUsdPerToken)).toString();
  return inferenceReservationSchema.parse({ id: randomUUID(), modelId, createdAt: new Date().toISOString(), calls: requests.length, inputTokensBound, outputTokensBound, reservedNanoUsd, requestHash: sha256(canonical(requests)) });
}

export function inferenceUsage(reservations: InferenceReservation[], now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return reservations.reduce((usage, input) => {
    const r = inferenceReservationSchema.parse(input);
    return { calls: usage.calls + r.calls, totalNanoUsd: (BigInt(usage.totalNanoUsd) + BigInt(r.reservedNanoUsd)).toString(),
      dayNanoUsd: (BigInt(usage.dayNanoUsd) + (r.createdAt.slice(0, 10) === day ? BigInt(r.reservedNanoUsd) : 0n)).toString(), day };
  }, { calls: 0, totalNanoUsd: '0', dayNanoUsd: '0', day });
}
export function checkInferenceBudget(reservations: InferenceReservation[], reservation: InferenceReservation, policy: InferenceBudgetPolicy) {
  inferenceBudgetSchema.parse(policy); inferenceReservationSchema.parse(reservation);
  const usage = inferenceUsage(reservations), amount = BigInt(reservation.reservedNanoUsd);
  if (usage.calls + reservation.calls > policy.maxCalls || BigInt(usage.totalNanoUsd) + amount > BigInt(policy.totalLimitNanoUsd) || BigInt(usage.dayNanoUsd) + amount > BigInt(policy.dailyLimitNanoUsd)) throw new Error('INFERENCE_BUDGET_EXHAUSTED: no model request was sent.');
}
