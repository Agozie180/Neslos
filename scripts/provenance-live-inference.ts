/** Explicitly authorized, one-call public-input probe. Does not attest its caller.
 * node --env-file=.env --import tsx scripts/provenance-live-inference.ts
 *   --policy reviewed-runtime-inference-policy.json --out new-result.json
 * This operation spends inference credit; inference-setup.ts is the free preflight.
 * A fixed repository-local reservation permits one paid probe across invocations.
 */
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createVerifiedInferenceClient, inferencePolicySchema } from '../src/core/inference.js';
import { checkInferenceBudget, estimateInference } from '../src/core/inference-budget.js';
import { sha256 } from '../src/core/crypto.js';

function safeFailure(error: unknown): string {
  const code = (error as { failure?: { code?: unknown } })?.failure?.code;
  if (typeof code === 'string' && /^[a-z0-9_.]{1,100}$/.test(code)) return code;
  return error instanceof Error && /^[A-Z][A-Z0-9_]+(?=:|$)/.test(error.message) ? error.message.split(':')[0]! : 'VERIFICATION_OR_TRANSPORT_FAILED';
}

async function main(args: string[]) {
  const { values } = parseArgs({ args, options: { policy: { type: 'string' }, out: { type: 'string' } }, strict: true });
  if (!values.policy || !values.out) throw new Error('POLICY_OUTPUT_REQUIRED');
  const policy = inferencePolicySchema.parse(JSON.parse(await readFile(values.policy, 'utf8')));
  if (BigInt(policy.budget.totalLimitNanoUsd) > 250_000_000n || policy.budget.maxOutputTokens !== 128) throw new Error('PROBE_BUDGET_LIMIT');
  const apiKey = process.env.NEARAI_API_KEY;
  if (!apiKey) throw new Error('NEARAI_API_KEY_REQUIRED');
  const request = { model: policy.modelId, temperature: 0, max_tokens: 128, messages: [{ role: 'user' as const, content: 'This is a public verification test. Reply with exactly the words: Neslos verified inference.' }] };
  const client = createVerifiedInferenceClient(policy, apiKey);
  const preflight = await client.verify(policy.modelId);
  if (('models' in preflight ? preflight.models : preflight.attestations).length === 0) throw new Error('MODEL_TEE_REQUIRED');
  const price = z.object({ amount: z.number().int().nonnegative().safe(), scale: z.literal(9), currency: z.literal('USD') });
  const catalogue = z.object({ models: z.array(z.object({ modelId: z.string(), inputCostPerToken: price, outputCostPerToken: price, metadata: z.object({ verifiable: z.boolean(), attestationSupported: z.boolean(), providerType: z.string() }) })) }).parse(await (await fetch('https://cloud-api.near.ai/v1/model/list', { signal: AbortSignal.timeout(30000) })).json());
  const model = catalogue.models.find(m => m.modelId === policy.modelId);
  if (!model || !model.metadata.verifiable || !model.metadata.attestationSupported || model.metadata.providerType !== 'vllm' || BigInt(model.inputCostPerToken.amount) > BigInt(policy.budget.inputNanoUsdPerToken) || BigInt(model.outputCostPerToken.amount) > BigInt(policy.budget.outputNanoUsdPerToken)) throw new Error('INFERENCE_PRICE_CHANGED');
  const reservation = estimateInference(policy.modelId, [request], policy.budget);
  checkInferenceBudget([], reservation, policy.budget);
  // A single probe is further capped at one cent, inside the caller's $0.25 ceiling.
  if (BigInt(reservation.reservedNanoUsd) > 10_000_000n) throw new Error('PROBE_RESERVATION_LIMIT');
  const outputPath = resolve(values.out);
  // Anchor to this checkout, not cwd or a caller-selected filename. Never delete
  // this reservation after failure: a provider timeout may already be billable.
  const reservationPath = fileURLToPath(new URL('../.private/provenance-live-inference-reservation.json', import.meta.url));
  if (outputPath === reservationPath) throw new Error('DISTINCT_OUTPUT_PATHS_REQUIRED');
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(reservationPath), { recursive: true });
  const output = await open(outputPath, 'wx', 0o600);
  await output.close();
  const journal = await open(reservationPath, 'wx', 0o600);
  try { await journal.writeFile(JSON.stringify(reservation, null, 2) + '\n'); await journal.sync(); } finally { await journal.close(); }
  if (process.platform !== 'win32') {
    const directory = await open(dirname(reservationPath), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  // The SDK sets maxRetries:0. Never repeat inference after an unknown outcome.
  const completion = await client.chat.completions.create(request, { signal: AbortSignal.timeout(120000) });
  await writeFile(outputPath, JSON.stringify({ callerExecution: 'local-unattested', inferenceCalls: 1, reservation, completion, responseVerified: false }, null, 2) + '\n', { mode: 0o600 });
  let receipt: Awaited<ReturnType<typeof client.verifyResponse>> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { receipt = await client.verifyResponse(completion.id); break; }
    catch (error) {
      if (attempt === 2 || !(error as { failure?: { retryable?: boolean } })?.failure?.retryable) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Receipt lookup only, never Chat.
    }
  }
  if (!receipt || receipt.signatureKind !== 'provider_tee') throw new Error('MODEL_TEE_REQUIRED');
  const summary = { callerExecution: 'local-unattested', modelId: policy.modelId, inferenceCalls: 1, responseVerified: true, signatureKind: receipt.signatureKind, completionId: completion.id, responseSha256: sha256(JSON.stringify(completion)), reservedNanoUsd: reservation.reservedNanoUsd, usage: completion.usage };
  await writeFile(outputPath, JSON.stringify({ ...summary, request, reservation, completion, receipt, preflight }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
}

/** Await the entire probe, including its durable output and failure reporting. */
export async function runProvenanceLiveInference(args: string[]): Promise<number> {
  try { await main(args); return 0; }
  catch (error) { console.error(JSON.stringify({ responseVerified: false, failure: safeFailure(error), retryInference: false })); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runProvenanceLiveInference(process.argv.slice(2));
