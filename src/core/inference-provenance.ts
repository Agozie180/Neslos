import { parse } from 'yaml';
import { z } from 'zod';
import { fetchImageProvenance, verifyImageProvenance, verifyDeploymentImageProvenance, type MeasuredDeployment, type ImageProvenancePolicy } from '@nearai/inference-sdk/node';
import { sha256 } from './crypto.js';

export const GATEWAY_IMAGE_POLICIES: Record<string, ImageProvenancePolicy> = {
  'nearaidev/cloud-api': { repository: 'nearai/cloud-api', workflow: '.github/workflows/build.yml' },
  'nearaidev/cvm-ingress': { repository: 'nearai/cvm-ingress', workflow: '.github/workflows/build-push.yml' },
  'nearaidev/dstack-vpc': { repository: 'nearai/dstack-vpc', workflow: '.github/workflows/build.yml' },
  'nearaidev/dstack-vpc-client': { repository: 'nearai/dstack-vpc-client', workflow: '.github/workflows/build.yml' },
};
const MODEL_IMAGES = { 'nearaidev/vllm-proxy-rs': { repository: 'nearai/inference-proxy', workflow: '.github/workflows/build.yml' } };
const MANAGER_POLICY = { repository: 'nearai/compose-manager', workflow: '.github/workflows/build.yml' };
const MAX_COMPOSE_BYTES = 1_000_000;

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
  const manager = deployment.composeManager;
  if (!manager) throw new Error('PROVENANCE_MANAGER_MISSING');
  const entries = [...manager.actions].reverse();
  const action = entries.find(e => e.action === 'compose_up');
  const started = entries.find(e => e.action === 'compose_manager_started');
  if (!action?.commit || !/^[a-f0-9]{40}$/.test(action.commit) || !action.file || !/^[a-zA-Z0-9_.\/-]+$/.test(action.file) || action.file.split('/').some(s => !s || s === '.' || s === '..') || !action.file_sha256) throw new Error('PROVENANCE_COMPOSE_REFERENCE');
  const digest = /^nearaidev\/compose-manager@(sha256:[a-f0-9]{64})$/.exec(started?.image?.replace(/^docker\.io\//, '') ?? '')?.[1];
  if (!digest) throw new Error('PROVENANCE_MANAGER_IMAGE');
  const url = `https://raw.githubusercontent.com/nearai/cvm-compose-files/${action.commit}/${action.file}`;
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
  const appCompose = normalizeAuthenticatedCompose(Buffer.concat(chunks), action.file_sha256, action.services);
  await verifyDeploymentImageProvenance({ appCompose, imagePolicies: MODEL_IMAGES, githubToken });
  const bundles = await fetchImageProvenance({ repository: MANAGER_POLICY.repository, digest, githubToken });
  await verifyImageProvenance({ bundles, digest, policy: MANAGER_POLICY });
}
