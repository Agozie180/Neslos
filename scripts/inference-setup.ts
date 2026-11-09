/** Free evidence collection only. This script has no inference or transaction operation.
 * node --env-file=.env --import tsx scripts/inference-setup.ts --out .private/inference-inspection.json
 * Add --approval reviewed-inference-deployment.json after independently reviewing the OS,
 * full appCompose bytes (including init scripts), image provenance and deployment actions.
 * Inspection output is evidence for review, never an automatically approved policy.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Quote } from '@phala/dcap-qvl';
import { createTdxQuoteVerifier, type MeasuredDeployment, type TdxQuoteVerifier } from '@nearai/inference-sdk/node';
import { z } from 'zod';
import { sha256 } from '../src/core/crypto.js';
import { checkModelDeploymentReference, createBootPinnedTdxQuoteVerifier, inferenceBootPolicySchema, modelDeploymentPolicySchema, modelDeploymentSelectorSchema, modelDeploymentReference, verifyGatewayBuildProvenance, verifyModelBuildProvenance } from '../src/core/inference-provenance.js';
import { InspectableInferenceClient } from '../src/core/inference-inspection.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pin = z.object({ osImageHash: hash, composeHash: hash, boot: inferenceBootPolicySchema }).strict();
const approvalSchema = z.object({
  format: z.literal('neslos-inference-deployment-v1'), modelId: z.string().min(1).max(100),
  gateway: pin, model: pin,
  modelDeployment: modelDeploymentPolicySchema,
}).strict();

function failureCode(error: unknown) {
  const failure = (error as { failure?: { code?: unknown } })?.failure;
  if (typeof failure?.code === 'string' && /^[a-z0-9_.]{1,100}$/.test(failure.code)) return failure.code;
  if (error instanceof z.ZodError) return 'INVALID_INPUT';
  const prefix = error instanceof Error ? /^[A-Z][A-Z0-9_]+(?=:|$)/.exec(error.message)?.[0] : undefined;
  return prefix ?? 'VERIFICATION_OR_TRANSPORT_FAILED';
}

async function main() {
  const { values } = parseArgs({ options: { model: { type: 'string' }, out: { type: 'string' }, approval: { type: 'string' }, 'deployment-file': { type: 'string' }, 'deployment-services': { type: 'string' } }, strict: true });
  if (!values.out) throw new Error('OUTPUT_PATH_REQUIRED');
  const outputPath = resolve(values.out);
  const approval = values.approval ? approvalSchema.parse(JSON.parse(await readFile(values.approval, 'utf8'))) : undefined;
  if (approval && (values['deployment-file'] || values['deployment-services'])) throw new Error('SELECTOR_COMES_FROM_APPROVAL');
  const selector = approval?.modelDeployment ?? ((values['deployment-file'] || values['deployment-services']) ? modelDeploymentSelectorSchema.parse({ file: values['deployment-file'], services: values['deployment-services']?.split(',') }) : undefined);
  const modelId = values.model ?? approval?.modelId ?? 'Qwen/Qwen3.8-27B';
  if (approval && modelId !== approval.modelId) throw new Error('INFERENCE_MODEL_MISMATCH');
  const apiKey = process.env.NEARAI_API_KEY;
  if (!apiKey) throw new Error('NEARAI_API_KEY_REQUIRED');
  const observedBoot: { kind: string; quoteSha256: string; boot: Record<string, string> }[] = [];
  const quoteVerifier = (kind: 'gateway' | 'model'): TdxQuoteVerifier => {
    const base = approval ? createBootPinnedTdxQuoteVerifier(approval[kind].boot) : createTdxQuoteVerifier();
    return async quote => {
      const verified = await base(quote);
      const bytes = Buffer.from(quote.replace(/^0x/, ''), 'hex');
      const td = Quote.parse(bytes).report.asTd10();
      if (!td) throw new Error('INFERENCE_BOOT_REPORT');
      observedBoot.push({ kind, quoteSha256: sha256(bytes), boot: Object.fromEntries((['mrTd', 'rtMr0', 'rtMr1', 'rtMr2'] as const).map(k => [k, Buffer.from(td[k]).toString('hex')])) });
      return verified;
    };
  };
  function checkDeployment(kind: 'gateway' | 'model', deployment: MeasuredDeployment) {
    if (!approval) return;
    const expected = approval[kind];
    if (deployment.runtimeMeasurements.osImageHash !== expected.osImageHash || deployment.runtimeMeasurements.composeHash !== expected.composeHash || sha256(deployment.appCompose) !== expected.composeHash) throw new Error('INFERENCE_MEASUREMENT');
    if (kind === 'model') checkModelDeploymentReference(deployment, approval.modelDeployment);
  }
  const client = new InspectableInferenceClient({
    apiKey, e2ee: true, attestationCacheTimeToLiveMs: 0,
    gatewayVerification: { includeSpkiFingerprint: true, policy: { acceptedTcbStatuses: ['UpToDate'] }, verifiers: { tdxQuote: quoteVerifier('gateway'), deployment: d => checkDeployment('gateway', d) } },
    modelVerification: { policy: { acceptedTcbStatuses: ['UpToDate'], gpuEvidence: 'required' }, verifiers: { tdxQuote: quoteVerifier('model'), deployment: d => checkDeployment('model', d) } },
    deploymentPolicy: ({ model }) => { if (model !== modelId) throw new Error('INFERENCE_MODEL_MISMATCH'); },
  });
  // verify() authenticates the Gateway and pins TLS before sending credentials for
  // model metadata/evidence. It does not POST a Chat request or consume inference credit.
  const verified = await client.verify(modelId);
  if (verified.models.length === 0) throw new Error('MODEL_TEE_REQUIRED');
  const builds = await Promise.allSettled([
    verifyGatewayBuildProvenance(verified.gateway.deployment.appCompose, process.env.GITHUB_TOKEN),
    ...verified.models.map(m => selector ? verifyModelBuildProvenance(m.deployment, selector, process.env.GITHUB_TOKEN) : Promise.reject(new Error('MODEL_SELECTOR_REQUIRED'))),
  ]);
  const buildChecks = builds.map((b, index) => b.status === 'fulfilled' ? { kind: index ? 'model' : 'gateway', verified: true, result: b.value } : { kind: index ? 'model' : 'gateway', verified: false, failure: failureCode(b.reason) });
  const allBuildsVerified = buildChecks.every(b => b.verified);
  const approved = !!approval && allBuildsVerified;
  const summary = {
    checkedAt: new Date().toISOString(), modelId, inferenceCalls: 0, approved,
    status: approved ? 'APPROVED_PREFLIGHT_PASSED' : !selector ? 'MODEL_SELECTOR_REQUIRED' : allBuildsVerified ? 'INDEPENDENT_REVIEW_REQUIRED' : 'BUILD_PROVENANCE_FAILED',
    gateway: { tcbStatus: verified.gateway.tcbStatus, tlsBinding: verified.gateway.tlsBinding.kind, measurements: verified.gateway.deployment.runtimeMeasurements },
    models: verified.models.map(m => {
      let deployment: unknown;
      try { deployment = selector ? modelDeploymentReference(m.deployment, selector) : { failure: 'MODEL_SELECTOR_REQUIRED' }; }
      catch (error) { deployment = { failure: failureCode(error) }; }
      return { tcbStatus: m.tcbStatus, gpuEvidence: m.gpuEvidence, measurements: m.deployment.runtimeMeasurements, deployment };
    }),
    observedBoot, buildChecks,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  // Never overwrite existing evidence; select a new output filename for each run.
  await writeFile(outputPath, JSON.stringify({ ...summary, verified, wireEvidence: client.wireEvidence() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
  if (!allBuildsVerified) process.exitCode = 2;
}

main().catch(error => { console.error(JSON.stringify({ inferenceCalls: 0, approved: false, failure: failureCode(error) })); process.exitCode = 1; });
