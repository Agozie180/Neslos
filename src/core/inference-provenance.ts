import { parse } from 'yaml';
import { z } from 'zod';
import { Quote } from '@phala/dcap-qvl';
import { createTdxQuoteVerifier, fetchImageProvenance, verifyImageProvenance, verifyDeploymentImageProvenance, type TdxQuoteVerifier, type MeasuredDeployment, type ImageProvenancePolicy } from '@nearai/inference-sdk/node';
import { canonical, sha256 } from './crypto.js';

export const GATEWAY_IMAGE_POLICIES: Record<string, ImageProvenancePolicy> = {
  'nearaidev/cloud-api': { repository: 'nearai/cloud-api', workflow: '.github/workflows/build.yml' },
  'nearaidev/cvm-ingress': { repository: 'nearai/cvm-ingress', workflow: '.github/workflows/build-push.yml' },
  'nearaidev/dstack-vpc': { repository: 'nearai/dstack-vpc', workflow: '.github/workflows/build.yml' },
  'nearaidev/dstack-vpc-client': { repository: 'nearai/dstack-vpc-client', workflow: '.github/workflows/build.yml' },
};
const MODEL_IMAGES = { 'nearaidev/vllm-proxy-rs': { repository: 'nearai/inference-proxy', workflow: '.github/workflows/build.yml' } };
const MANAGER_POLICY = { repository: 'nearai/compose-manager', workflow: '.github/workflows/build.yml' };
const MAX_COMPOSE_BYTES = 1_000_000;

const bootMeasurement = z.string().regex(/^[a-f0-9]{96}$/);
/** Derive these from reviewed OS artifacts and VM configuration, never the service's quote. */
export const inferenceBootPolicySchema = z.object({ mrTd: bootMeasurement, rtMr0: bootMeasurement, rtMr1: bootMeasurement, rtMr2: bootMeasurement }).strict();
export type InferenceBootPolicy = z.infer<typeof inferenceBootPolicySchema>;
export const modelDeploymentPolicySchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  file: z.string().regex(/^[a-zA-Z0-9_.\/-]+$/).refine(path => path.split('/').every(part => part !== '' && part !== '.' && part !== '..')),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  actionsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  managerImage: z.string().regex(/^nearaidev\/compose-manager@sha256:[a-f0-9]{64}$/),
  services: z.array(z.string().min(1).max(200)).max(1000).optional(),
}).strict();

export function checkModelDeploymentReference(deployment: MeasuredDeployment, approved: z.infer<typeof modelDeploymentPolicySchema>): void {
  const actual = modelDeploymentReference(deployment);
  for (const field of ['commit', 'file', 'fileSha256', 'managerImage', 'actionsSha256'] as const) if (actual[field] !== approved[field]) throw new Error('INFERENCE_MODEL_DEPLOYMENT');
  if (JSON.stringify(actual.services ?? []) !== JSON.stringify(approved.services ?? [])) throw new Error('INFERENCE_MODEL_SERVICES');
}

/** SDK 0.2.1 authenticates the quote but does not allowlist its boot registers. */
export function createBootPinnedTdxQuoteVerifier(approved: InferenceBootPolicy, verify: TdxQuoteVerifier = createTdxQuoteVerifier()): TdxQuoteVerifier {
  const pins = inferenceBootPolicySchema.parse(approved);
  return async quote => {
    // Verify the exact bytes first; parsing alone is never hardware verification.
    const result = await verify(quote);
    const td = Quote.parse(Buffer.from(quote.replace(/^0x/, ''), 'hex')).report.asTd10();
    if (!td) throw new Error('INFERENCE_BOOT_REPORT');
    for (const field of ['mrTd', 'rtMr0', 'rtMr1', 'rtMr2'] as const) {
      if (Buffer.from(td[field]).toString('hex') !== pins[field]) throw new Error('INFERENCE_BOOT_MEASUREMENT');
    }
    return result;
  };
}

export function modelDeploymentReference(deployment: MeasuredDeployment) {
  const manager = deployment.composeManager;
  if (!manager) throw new Error('PROVENANCE_MANAGER_MISSING');
  const entries = [...manager.actions].reverse();
  const action = entries.find(e => e.action === 'compose_up');
  const started = entries.find(e => e.action === 'compose_manager_started');
  if (!action?.commit || !/^[a-f0-9]{40}$/.test(action.commit) || !action.file || !/^[a-zA-Z0-9_.\/-]+$/.test(action.file) || action.file.split('/').some(s => !s || s === '.' || s === '..') || !/^[a-f0-9]{64}$/.test(action.file_sha256 ?? '')) throw new Error('PROVENANCE_COMPOSE_REFERENCE');
  const digest = /^nearaidev\/compose-manager@(sha256:[a-f0-9]{64})$/.exec(started?.image?.replace(/^docker\.io\//, '') ?? '')?.[1];
  if (!digest) throw new Error('PROVENANCE_MANAGER_IMAGE');
  return { commit: action.commit, file: action.file, fileSha256: action.file_sha256!, services: action.services, managerImage: `nearaidev/compose-manager@${digest}`, managerDigest: digest,
    // Locally canonicalized full history, including earlier engine launches and
    // control actions. This is distinct from the SDK's wire actionsHash format.
    actionsSha256: sha256(canonical(manager.actions)),
  };
}

/** Authenticate bytes before expanding aliases, then bound the expanded object too. */
export function normalizeAuthenticatedCompose(bytes: Uint8Array, expectedHash: string, selectedServices?: readonly string[]): string {
  if (bytes.byteLength > MAX_COMPOSE_BYTES) throw new Error('PROVENANCE_COMPOSE_SIZE');
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(bytes) !== expectedHash) throw new Error('PROVENANCE_COMPOSE_HASH');
  // NEAR AI's 172 KB small-models.yaml needs >200 aliases; SDK 0.2.1 defaults to 100.
  // Keep a finite expansion limit and a second serialized-size ceiling.
  const parsed = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { merge: true, maxAliasCount: 500, logLevel: 'error' });
  const compose = z.object({ services: z.record(z.string(), z.object({ image: z.string().optional() }).passthrough()) }).passthrough().parse(parsed);
  if (Buffer.byteLength(JSON.stringify(compose)) > MAX_COMPOSE_BYTES) throw new Error('PROVENANCE_COMPOSE_SIZE');
  const names = selectedServices?.length ? selectedServices : Object.keys(compose.services);
  const services: Record<string, unknown> = {};
  for (const name of names) {
    if (!Object.hasOwn(compose.services, name)) throw new Error('PROVENANCE_SERVICE_MISSING');
    Object.defineProperty(services, name, { value: compose.services[name], enumerable: true });
  }
  // JSON is a YAML subset; the SDK still validates image pinning and all required repositories.
  return JSON.stringify({ docker_compose_file: JSON.stringify({ services }) });
}

/** Input must come from SDK hardware verification, never raw provider JSON. */
export async function verifyModelBuildProvenance(deployment: MeasuredDeployment, githubToken?: string) {
  const reference = modelDeploymentReference(deployment);
  const url = `https://raw.githubusercontent.com/nearai/cvm-compose-files/${reference.commit}/${reference.file}`;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new Error('PROVENANCE_COMPOSE_UNAVAILABLE');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_COMPOSE_BYTES) { await reader.cancel(); throw new Error('PROVENANCE_COMPOSE_SIZE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const appCompose = normalizeAuthenticatedCompose(Buffer.concat(chunks), reference.fileSha256, reference.services);
  await verifyDeploymentImageProvenance({ appCompose, imagePolicies: MODEL_IMAGES, githubToken });
  const bundles = await fetchImageProvenance({ repository: MANAGER_POLICY.repository, digest: reference.managerDigest, githubToken });
  const managerBuild = await verifyImageProvenance({ bundles, digest: reference.managerDigest, policy: MANAGER_POLICY });
  return { ...reference, sourceUrl: url, managerBuild };
}
