import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), options: vi.fn() }));
vi.mock('@nearai/inference-sdk/node', () => ({ InferenceClient: class {
  constructor(options: unknown) { mocks.options(options); }
  chat = { completions: { create: mocks.create } }; verifyResponse = mocks.verify;
} }));
import { PrivateResearchers } from '../src/core/inference.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
import type { ResearchResult } from '../src/core/types.js';

const policy = { modelId: 'test-model', gateway: { osImageHash: 'aa'.repeat(32), composeHash: 'bb'.repeat(32) }, model: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32) } };
const evidence: ResearchResult = { sourceMode: 'live', fetchedAt: new Date().toISOString(), upstreamObservedAt: null, sourceUrl: 'https://fixture.invalid', notices: [], markets: [] };
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ id: 'test-completion', choices: [{ message: { content: JSON.stringify({ summary: 'No eligible markets supplied.', findings: ['No executable opportunity'], marketIds: [] }) } }] }); mocks.verify.mockResolvedValue({ signatureKind: 'provider_tee' }); });
describe('NEAR AI researcher orchestration with fixture SDK responses', () => {
  it('requires encrypted inference, fresh attestations and approved gateway/model measurements', async () => {
    const researchers = new PrivateResearchers(policy, 'fixture-only');
    const options = mocks.options.mock.calls[0]![0];
    expect(options).toMatchObject({ e2ee: true, attestationCacheTimeToLiveMs: 0, gatewayVerification: { includeSpkiFingerprint: true }, modelVerification: { policy: { gpuEvidence: 'required', acceptedTcbStatuses: ['UpToDate'] } } });
    expect(() => options.deploymentPolicy({ model: 'wrong', deployment: {} })).toThrow('Unapproved');
    expect(() => options.gatewayVerification.verifiers.deployment({ runtimeMeasurements: policy.model })).toThrow('INFERENCE_MEASUREMENT');
    const reports = await researchers.research(evidence, DEFAULT_POLICY, 'Research supplied opportunities');
    expect(reports.map(r => r.agent)).toEqual(['lending', 'liquidity', 'risk']); expect(mocks.verify).toHaveBeenCalledTimes(3);
  });
  it('rejects gateway-only signatures', async () => {
    mocks.verify.mockResolvedValue({ signatureKind: 'gateway' });
    await expect(new PrivateResearchers(policy, 'fixture').research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRIVATE_RESEARCH_FAILED');
  });
  it('rejects invented market references', async () => {
    mocks.create.mockResolvedValue({ id: 'test', choices: [{ message: { content: JSON.stringify({ summary: 'Invented', findings: ['Invented'], marketIds: ['does-not-exist'] }) } }] });
    await expect(new PrivateResearchers(policy, 'fixture').research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRIVATE_RESEARCH_FAILED');
  });
  it('fails the whole research request if any required agent verification fails', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('invalid signature'));
    await expect(new PrivateResearchers(policy, 'fixture').research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRIVATE_RESEARCH_FAILED');
    expect(mocks.verify).toHaveBeenCalledTimes(3);
  });
  it('rejects reference data before calling inference', async () => {
    await expect(new PrivateResearchers(policy, 'fixture').research({ ...evidence, sourceMode: 'reference' }, DEFAULT_POLICY, 'Research')).rejects.toThrow('LIVE_EVIDENCE_REQUIRED');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
