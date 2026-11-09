import { afterEach, describe, expect, it, vi } from 'vitest';
import { Quote } from '@phala/dcap-qvl';
import type { MeasuredDeployment, TdxQuoteVerificationResult } from '@nearai/inference-sdk/node';
import { checkModelDeploymentReference, createBootPinnedTdxQuoteVerifier, gatewayImagePolicies, inferenceBootPolicySchema, modelDeploymentPolicySchema, modelDeploymentReference, normalizeAuthenticatedCompose, verifyModelBuildProvenance } from '../src/core/inference-provenance.js';
import { canonical, sha256 } from '../src/core/crypto.js';
import { gatewayAppComposeFixture } from './fixtures/inference.js';

describe('gateway build scope across provider topologies', () => {
  function app(extra: Record<string, { image: string }> = {}, omit?: string) {
    const compose = JSON.parse(JSON.parse(gatewayAppComposeFixture).docker_compose_file);
    Object.assign(compose.services, extra);
    if (omit) delete compose.services[omit];
    return JSON.stringify({ docker_compose_file: JSON.stringify(compose) });
  }
  it('verifies API and ingress without requiring absent VPC services', () => {
    expect(Object.keys(gatewayImagePolicies(app()))).toEqual(['nearaidev/cloud-api', 'nearaidev/cvm-ingress']);
  });
  it('retains verification of every VPC component present in older gateway deployments', () => {
    expect(Object.keys(gatewayImagePolicies(app({
      vpc: { image: 'docker.io/nearaidev/dstack-vpc@sha256:' + 'c'.repeat(64) },
      client: { image: 'nearaidev/dstack-vpc-client:v1@sha256:' + 'd'.repeat(64) },
    })))).toHaveLength(4);
  });
  it.each(['api', 'ingress'])('rejects removal of the required %s image', name => {
    expect(() => gatewayImagePolicies(app({}, name))).toThrow('PROVENANCE_GATEWAY_REQUIRED_IMAGE');
  });
  it.each(['nearaidev/dstack-vpc:latest', '${VPC_IMAGE}', 'alpine:latest', 'nearaidev/dstack-vpc@sha256:' + 'a'.repeat(64) + '\n'])('rejects mutable or unresolved images, including optional components: %s', image => {
    expect(() => gatewayImagePolicies(app({ optional: { image } }))).toThrow('PROVENANCE_GATEWAY_IMAGE_PIN');
  });
  it('rejects an unreviewed provider repository instead of silently excluding it', () => {
    expect(() => gatewayImagePolicies(app({ other: { image: 'nearaidev/unknown@sha256:' + 'c'.repeat(64) } }))).toThrow('PROVENANCE_GATEWAY_UNKNOWN_IMAGE');
  });
  it.each(['{}', 'not json', 'x'.repeat(1_000_001)])('rejects malformed or oversized measured Compose input', value => {
    expect(() => gatewayImagePolicies(value)).toThrow('PROVENANCE_GATEWAY_COMPOSE');
  });
});

describe('authenticated model compose normalization', () => {
  it('supports a bounded real-world number of repeated aliases and preserves selected images', () => {
    const bytes = Buffer.from('x-env: &env\n  LOG_LEVEL: info\nservices:\n' + Array.from({ length: 250 }, (_, i) => `  model${i}:\n    image: nearaidev/vllm-proxy-rs@sha256:${'a'.repeat(64)}\n    environment: *env\n`).join(''));
    const app = JSON.parse(normalizeAuthenticatedCompose(bytes, sha256(bytes), ['model2']));
    expect(Object.keys(JSON.parse(app.docker_compose_file).services)).toEqual(['model2']);
  });
  it('rejects altered bytes before parsing, absent services and oversized input', () => {
    const b = Buffer.from('services: {model: {image: image}}');
    expect(() => normalizeAuthenticatedCompose(b, '0'.repeat(64))).toThrow('PROVENANCE_COMPOSE_HASH');
    expect(() => normalizeAuthenticatedCompose(b, sha256(b), ['missing'])).toThrow('PROVENANCE_SERVICE_MISSING');
    expect(() => normalizeAuthenticatedCompose(Buffer.alloc(1_000_001), '0'.repeat(64))).toThrow('PROVENANCE_COMPOSE_SIZE');
  });
  it('retains alias exhaustion protection', () => {
    const bytes = Buffer.from('a: &a [a,a,a,a,a,a,a,a,a,a]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\nservices: {model: {environment: *d}}');
    expect(() => normalizeAuthenticatedCompose(bytes, sha256(bytes))).toThrow();
  });
});

describe('inference boot approval', () => {
  const boot = { mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48) };
  const result: TdxQuoteVerificationResult = { tcbStatus: 'UpToDate', advisoryIds: [], debugEnabled: false, reportData: new Uint8Array(64), mrConfigId: new Uint8Array(48), rtMr3: new Uint8Array(48) };
  afterEach(() => vi.restoreAllMocks());
  function parsed(overrides: Partial<typeof boot> = {}) {
    const fields = Object.fromEntries(Object.entries({ ...boot, ...overrides }).map(([k, v]) => [k, Buffer.from(v, 'hex')]));
    return { report: { asTd10: () => fields } } as unknown as ReturnType<typeof Quote.parse>;
  }
  it('authenticates the quote before reading any boot measurements', async () => {
    const parse = vi.spyOn(Quote, 'parse');
    const verifier = createBootPinnedTdxQuoteVerifier(boot, async () => { throw new Error('invalid Intel signature'); });
    await expect(verifier('00')).rejects.toThrow('invalid Intel signature');
    expect(parse).not.toHaveBeenCalled();
  });
  it('preserves authenticated SDK facts for nonce, TCB and RTMR3 checks', async () => {
    vi.spyOn(Quote, 'parse').mockReturnValue(parsed());
    await expect(createBootPinnedTdxQuoteVerifier(boot, async () => result)('00')).resolves.toBe(result);
  });
  it.each(['mrTd', 'rtMr0', 'rtMr1', 'rtMr2'] as const)('rejects a different authenticated %s', async field => {
    vi.spyOn(Quote, 'parse').mockReturnValue(parsed({ [field]: 'ff'.repeat(48) }));
    await expect(createBootPinnedTdxQuoteVerifier(boot, async () => result)('00')).rejects.toThrow('INFERENCE_BOOT_MEASUREMENT');
  });
  it('rejects incomplete boot approval and non-TDX evidence', async () => {
    expect(() => inferenceBootPolicySchema.parse({ ...boot, rtMr2: '00' })).toThrow();
    vi.spyOn(Quote, 'parse').mockReturnValue({ report: { asTd10: () => null } } as unknown as ReturnType<typeof Quote.parse>);
    await expect(createBootPinnedTdxQuoteVerifier(boot, async () => result)('00')).rejects.toThrow('INFERENCE_BOOT_REPORT');
  });
});

describe('model deployment references', () => {
  const action = { timestamp: '2026-11-06T00:00:00Z', action: 'compose_up', commit: 'a'.repeat(40), file: 'prod/small-models.yaml', file_sha256: 'b'.repeat(64), services: ['proxy-qwen38-27b'] };
  const selector = { file: action.file, services: action.services };
  const deployment = (actions: unknown[]) => ({ appCompose: '{}', runtimeMeasurements: {}, composeManager: { actions, tcbStatus: 'UpToDate', advisoryIds: [], runtimeMeasurements: {} } }) as MeasuredDeployment;
  const started = { timestamp: '2026-11-06T00:01:00Z', action: 'compose_manager_started', image: `nearaidev/compose-manager@sha256:${'c'.repeat(64)}` };
  it('labels attempted source references and ignores manager starts and staged-only actions', () => {
    expect(modelDeploymentReference(deployment([action, { ...action, action: 'compose_stage', commit: 'd'.repeat(40) }, started]), selector)).toMatchObject({ referenceKind: 'latest-attempted-compose-up', commit: action.commit, fileSha256: action.file_sha256, services: action.services, managerImage: started.image });
  });
  it('selects only owner-approved services from a launch with several models', () => {
    expect(modelDeploymentReference(deployment([{ ...action, services: [...action.services, 'proxy-deepseek'] }, started]), selector).services).toEqual(selector.services);
  });
  it.each(['prod/small-models.yaml', 'prod/other-models.yaml'])('rejects later apparently disjoint mutations in %s instead of selecting the wrong model or an older attempt', file => {
    for (const operation of ['compose_up', 'compose_down']) {
      const unrelated = { ...action, action: operation, file, services: ['proxy-deepseek'], commit: 'd'.repeat(40) };
      expect(() => modelDeploymentReference(deployment([action, started, unrelated]), selector)).toThrow('PROVENANCE_COMPOSE_AMBIGUOUS_MUTATION');
    }
  });
  it('rejects traversal, malformed digest and a mutable manager image', () => {
    expect(() => modelDeploymentReference(deployment([action, started]), { ...selector, file: '../arbitrary.yaml' })).toThrow('PROVENANCE_MODEL_SELECTOR');
    expect(() => modelDeploymentReference(deployment([{ ...action, file: '../arbitrary.yaml' }, started]), selector)).toThrow('PROVENANCE_COMPOSE_SCOPE');
    expect(() => modelDeploymentReference(deployment([{ ...action, file_sha256: 'bogus' }, started]), selector)).toThrow('PROVENANCE_COMPOSE_REFERENCE');
    expect(() => modelDeploymentReference(deployment([action, { ...started, image: 'nearaidev/compose-manager:latest' }]), selector)).toThrow('PROVENANCE_MANAGER_IMAGE');
  });
  it('requires explicit, nonempty unique services before any build lookup', async () => {
    const model = deployment([action, started]);
    for (const services of [undefined, [], ['proxy-qwen38-27b', 'proxy-qwen38-27b']]) {
      const invalid = { ...selector, services } as unknown as typeof selector;
      expect(() => modelDeploymentReference(model, invalid)).toThrow('PROVENANCE_MODEL_SELECTOR');
      await expect(verifyModelBuildProvenance(model, invalid)).rejects.toThrow('PROVENANCE_MODEL_SELECTOR');
    }
    expect(() => modelDeploymentReference(model, undefined as unknown as typeof selector)).toThrow('PROVENANCE_MODEL_SELECTOR');
  });
  it('checks the latest selected launch before comparing an approved commit', () => {
    const { managerDigest: _digest, referenceKind: _kind, ...approved } = modelDeploymentReference(deployment([action, started]), selector);
    const changed = { ...action, commit: 'd'.repeat(40), file_sha256: 'e'.repeat(64) };
    const actions = [action, started, changed];
    expect(modelDeploymentReference(deployment(actions), approved).commit).toBe(changed.commit);
    // Even approval of the complete new history cannot select the old commit.
    expect(() => checkModelDeploymentReference(deployment(actions), { ...approved, actionsSha256: sha256(canonical(actions)) })).toThrow('INFERENCE_MODEL_DEPLOYMENT');
  });
  it('does not skip cross-file redeploys or combine services from split launches', () => {
    expect(() => modelDeploymentReference(deployment([action, started, { ...action, file: 'prod/other.yaml' }]), selector)).toThrow('PROVENANCE_COMPOSE_SCOPE');
    const both = { ...selector, services: [...selector.services, 'proxy-second'] };
    expect(() => modelDeploymentReference(deployment([{ ...action, services: both.services }, started, action]), both)).toThrow('PROVENANCE_COMPOSE_SPLIT_REFERENCE');
  });
  it('rejects later stop, unscoped and unknown control actions', () => {
    expect(() => modelDeploymentReference(deployment([action, started, { ...action, action: 'compose_down' }]), selector)).toThrow('PROVENANCE_COMPOSE_STOP_ATTEMPT');
    for (const services of [undefined, []]) expect(() => modelDeploymentReference(deployment([action, started, { ...action, services }]), selector)).toThrow('PROVENANCE_COMPOSE_SCOPE');
    for (const operation of ['docker_restart', 'new_control']) expect(() => modelDeploymentReference(deployment([action, started, { timestamp: started.timestamp, action: operation, container: 'unmapped-container' }]), selector)).toThrow('PROVENANCE_COMPOSE_CONTROL');
  });
  it('requires complete-history approval and rejects changed earlier engine or administrative actions', () => {
    const engine = { ...action, services: ['model-engine'], commit: 'e'.repeat(40) };
    const original = deployment([engine, action, started]);
    const reference = modelDeploymentReference(original, selector);
    expect(reference.actionsSha256).toBe(sha256(canonical(original.composeManager!.actions)));
    const { managerDigest: _digest, referenceKind: _kind, ...approved } = reference;
    expect(() => checkModelDeploymentReference(original, modelDeploymentPolicySchema.parse(approved))).not.toThrow();
    const { actionsSha256: _history, ...missingHistory } = approved;
    expect(() => modelDeploymentPolicySchema.parse(missingHistory)).toThrow();
    const { services: _services, ...missingServices } = approved;
    expect(() => modelDeploymentPolicySchema.parse(missingServices)).toThrow();
    expect(() => checkModelDeploymentReference(deployment([{ ...engine, commit: 'f'.repeat(40) }, action, started]), approved)).toThrow('INFERENCE_MODEL_DEPLOYMENT');
    expect(() => checkModelDeploymentReference(deployment([engine, action, started, { ...action, action: 'compose_stage', services: ['unrelated-model'] }]), approved)).toThrow('INFERENCE_MODEL_DEPLOYMENT');
    expect(() => checkModelDeploymentReference(deployment([engine, action, started, { timestamp: started.timestamp, action: 'docker_restart', container: 'model-engine' }]), approved)).toThrow('PROVENANCE_COMPOSE_CONTROL');
  });
});
