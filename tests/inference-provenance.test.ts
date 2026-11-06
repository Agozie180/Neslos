import { afterEach, describe, expect, it, vi } from 'vitest';
import { Quote } from '@phala/dcap-qvl';
import type { MeasuredDeployment, TdxQuoteVerificationResult } from '@nearai/inference-sdk/node';
import { checkModelDeploymentReference, createBootPinnedTdxQuoteVerifier, inferenceBootPolicySchema, modelDeploymentPolicySchema, modelDeploymentReference, normalizeAuthenticatedCompose } from '../src/core/inference-provenance.js';
import { sha256 } from '../src/core/crypto.js';

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
  const deployment = (actions: unknown[]) => ({ appCompose: '{}', runtimeMeasurements: {}, composeManager: { actions, tcbStatus: 'UpToDate', advisoryIds: [], runtimeMeasurements: {} } }) as MeasuredDeployment;
  const started = { timestamp: '2026-11-06T00:01:00Z', action: 'compose_manager_started', image: `nearaidev/compose-manager@sha256:${'c'.repeat(64)}` };
  it('keeps deployment and manager updates distinct and ignores staged-only actions', () => {
    expect(modelDeploymentReference(deployment([action, { ...action, action: 'compose_stage', commit: 'd'.repeat(40) }, started]))).toMatchObject({ commit: action.commit, fileSha256: action.file_sha256, services: action.services, managerImage: started.image });
  });
  it('rejects traversal, malformed digest and a mutable manager image', () => {
    expect(() => modelDeploymentReference(deployment([{ ...action, file: '../arbitrary.yaml' }, started]))).toThrow('PROVENANCE_COMPOSE_REFERENCE');
    expect(() => modelDeploymentReference(deployment([{ ...action, file_sha256: 'bogus' }, started]))).toThrow('PROVENANCE_COMPOSE_REFERENCE');
    expect(() => modelDeploymentReference(deployment([action, { ...started, image: 'nearaidev/compose-manager:latest' }]))).toThrow('PROVENANCE_MANAGER_IMAGE');
  });
  it('requires complete-history approval and rejects changed earlier engine or administrative actions', () => {
    const engine = { ...action, services: ['model-engine'], commit: 'e'.repeat(40) };
    const original = deployment([engine, action, started]);
    const reference = modelDeploymentReference(original);
    const { managerDigest: _digest, ...approved } = reference;
    expect(() => checkModelDeploymentReference(original, modelDeploymentPolicySchema.parse(approved))).not.toThrow();
    const { actionsSha256: _history, ...missingHistory } = approved;
    expect(() => modelDeploymentPolicySchema.parse(missingHistory)).toThrow();
    expect(() => checkModelDeploymentReference(deployment([{ ...engine, commit: 'f'.repeat(40) }, action, started]), approved)).toThrow('INFERENCE_MODEL_DEPLOYMENT');
    expect(() => checkModelDeploymentReference(deployment([engine, action, started, { timestamp: started.timestamp, action: 'docker_restart', container: 'model-engine' }]), approved)).toThrow('INFERENCE_MODEL_DEPLOYMENT');
  });
});
