import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), options: vi.fn(), reserve: vi.fn(), gatewayBuild: vi.fn(), modelBuild: vi.fn() }));
vi.mock('@nearai/inference-sdk/node', async original => ({ ...await original<typeof import('@nearai/inference-sdk/node')>(), verifyDeploymentImageProvenance: mocks.gatewayBuild, InferenceClient: class {
  constructor(options: unknown) { mocks.options(options); }
  chat = { completions: { create: mocks.create } }; verifyResponse = mocks.verify;
} }));
vi.mock('../src/core/inference-provenance.js', async original => ({ ...await original<typeof import('../src/core/inference-provenance.js')>(), verifyModelBuildProvenance: mocks.modelBuild }));
import { PrivateResearchers } from '../src/core/inference.js';
import { composeManagerFixture, inferenceBootFixture, modelDeploymentFixture } from './fixtures/inference.js';
import { checkInferenceBudget, DISABLED_INFERENCE_BUDGET, inferenceUsage, type InferenceReservation } from '../src/core/inference-budget.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
import type { ResearchResult } from '../src/core/types.js';

const policy = { modelId: 'test-model', gateway: { osImageHash: 'aa'.repeat(32), composeHash: 'bb'.repeat(32), boot: inferenceBootFixture }, model: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32), boot: inferenceBootFixture }, modelDeployment: modelDeploymentFixture, budget: { totalLimitNanoUsd: '100000000', dailyLimitNanoUsd: '20000000', maxCalls: 6, inputNanoUsdPerToken: '80', outputNanoUsdPerToken: '500' } };
const evidence: ResearchResult = { sourceMode: 'live', fetchedAt: new Date().toISOString(), upstreamObservedAt: null, sourceUrl: 'https://fixture.invalid', notices: [], markets: [{ id: 'rhea:token.near', tokenId: 'token.near', protocol: 'Rhea', venue: 'rhea-lending', symbol: 'USDC', chain: 'NEAR', totalApy: 4, baseApy: 4, rewardApy: 0, tvlUsd: 2000000, liquidityUsd: 1000000, utilization: 0.5, stablecoin: true, bridged: false, sourceUrl: 'https://fixture.invalid', sourceMode: 'live', fetchedAt: new Date().toISOString(), upstreamObservedAt: null, risks: [] }] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.reserve.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: 'test-completion', choices: [{ message: { content: JSON.stringify({ summary: 'Eligible market reviewed.', findings: ['Observed evidence'], marketIds: ['rhea:token.near'], assessments: [{ marketId: 'rhea:token.near', decision: 'approve', reason: 'Reported liquidity is sufficient.' }] }) } }] });
  mocks.verify.mockResolvedValue({ signatureKind: 'provider_tee' });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ models: [{ modelId: 'test-model', inputCostPerToken: { amount: 80, scale: 9, currency: 'USD' }, outputCostPerToken: { amount: 500, scale: 9, currency: 'USD' }, metadata: { verifiable: true, attestationSupported: true, providerType: 'vllm' } }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('NEAR AI researcher orchestration with fixture SDK responses', () => {
  it('requires encrypted inference, fresh attestations and approved gateway/model measurements', async () => {
    const researchers = new PrivateResearchers(policy, 'fixture-only', mocks.reserve);
    const options = mocks.options.mock.calls[0]![0];
    expect(options).toMatchObject({ e2ee: true, attestationCacheTimeToLiveMs: 0, gatewayVerification: { includeSpkiFingerprint: true }, modelVerification: { policy: { gpuEvidence: 'required', acceptedTcbStatuses: ['UpToDate'] } } });
    expect(() => options.deploymentPolicy({ model: 'wrong', deployment: {} })).toThrow('Unapproved');
    await expect(options.gatewayVerification.verifiers.deployment({ runtimeMeasurements: policy.model })).rejects.toThrow('INFERENCE_MEASUREMENT');
    expect(options.gatewayVerification.verifiers.tdxQuote).toBeTypeOf('function');
    expect(options.modelVerification.verifiers.tdxQuote).toBeTypeOf('function');
    const reports = await researchers.research(evidence, DEFAULT_POLICY, 'Research supplied opportunities');
    expect(reports.map(r => r.agent)).toEqual(['lending', 'liquidity', 'risk']); expect(mocks.verify).toHaveBeenCalledTimes(3);
  });
  it('rejects gateway-only signatures', async () => {
    mocks.verify.mockResolvedValue({ signatureKind: 'gateway' });
    await expect(new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRIVATE_RESEARCH_FAILED');
  });
  it('rejects invented market references', async () => {
    mocks.create.mockResolvedValue({ id: 'test', choices: [{ message: { content: JSON.stringify({ summary: 'Invented', findings: ['Invented'], marketIds: ['does-not-exist'], assessments: [] }) } }] });
    await expect(new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRIVATE_RESEARCH_FAILED');
  });
  it('fails the whole research request if any required agent verification fails', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('invalid signature'));
    await expect(new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRIVATE_RESEARCH_FAILED');
    expect(mocks.verify).toHaveBeenCalledTimes(3);
  });
  it('reports diagnostic categories without returning upstream messages or credentials', async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('secret-key-should-not-leak'), { status: 402 }));
    await expect(new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('lending: HTTP_402');
    mocks.create.mockRejectedValue(new Error('secret-key-should-not-leak'));
    try { await new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research'); throw new Error('Expected failure'); }
    catch (error) { expect((error as Error).message).not.toContain('secret-key'); expect((error as Error).message).toContain('VERIFICATION_OR_TRANSPORT_FAILED'); }
  });
  it('rejects reference data before calling inference', async () => {
    await expect(new PrivateResearchers(policy, 'fixture').research({ ...evidence, sourceMode: 'reference' }, DEFAULT_POLICY, 'Research')).rejects.toThrow('LIVE_EVIDENCE_REQUIRED');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('never starts inference if the durable budget reservation fails', async () => {
    mocks.reserve.mockRejectedValue(new Error('INFERENCE_BUDGET_EXHAUSTED'));
    await expect(new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('avoids paid calls when policy excludes all opportunities', async () => {
    const reports = await new PrivateResearchers(policy, 'fixture', mocks.reserve).research({ ...evidence, markets: [] }, DEFAULT_POLICY, 'Research');
    expect(reports).toHaveLength(3); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects an increased catalogue price before reserving or spending credit', async () => {
    await expect(new PrivateResearchers({ ...policy, budget: { ...policy.budget, inputNanoUsdPerToken: '1' } }, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research')).rejects.toThrow('PRICE_CHANGED');
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('accounts for the day credit is reserved when catalogue verification crosses midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T23:59:59.999Z'));
    const catalogue = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      vi.setSystemTime(new Date('2026-11-07T00:00:00.001Z'));
      return catalogue(...args);
    });
    await new PrivateResearchers(policy, 'fixture', mocks.reserve).research(evidence, DEFAULT_POLICY, 'Research');
    const reserved = mocks.reserve.mock.calls[0]![0] as InferenceReservation;
    expect(inferenceUsage([reserved]).dayNanoUsd).toBe(reserved.reservedNanoUsd);
    expect(() => checkInferenceBudget([reserved], { ...reserved, createdAt: new Date().toISOString() }, {
      ...DISABLED_INFERENCE_BUDGET, ...policy.budget, dailyLimitNanoUsd: reserved.reservedNanoUsd,
    })).toThrow('INFERENCE_BUDGET_EXHAUSTED');
  });
  it('keeps independently approved deployment pins when the caller mutates its input policy', async () => {
    const supplied = structuredClone(policy);
    new PrivateResearchers(supplied, 'fixture', mocks.reserve);
    const options = mocks.options.mock.calls[0]![0];
    supplied.gateway.osImageHash = 'ee'.repeat(32);
    supplied.model.composeHash = 'ff'.repeat(32);
    supplied.modelId = 'replacement-model';
    await expect(options.gatewayVerification.verifiers.deployment({ runtimeMeasurements: policy.gateway })).resolves.toBeUndefined();
    expect(() => options.deploymentPolicy({ model: policy.modelId, deployment: { runtimeMeasurements: policy.model, composeManager: composeManagerFixture } })).not.toThrow();
    await expect(options.gatewayVerification.verifiers.deployment({ runtimeMeasurements: supplied.gateway })).rejects.toThrow('INFERENCE_MEASUREMENT');
    expect(() => options.deploymentPolicy({ model: supplied.modelId, deployment: { runtimeMeasurements: supplied.model } })).toThrow('Unapproved');
  });
  it('rejects policies missing boot approval before configuring a client', () => {
    const supplied = structuredClone(policy) as any;
    delete supplied.gateway.boot;
    expect(() => new PrivateResearchers(supplied, 'fixture', mocks.reserve)).toThrow();
    expect(mocks.options).not.toHaveBeenCalled();
  });
  it('requires reviewed dynamic deployment and both image-build verifiers', async () => {
    new PrivateResearchers(policy, 'fixture', mocks.reserve);
    const options = mocks.options.mock.calls[0]![0];
    const model = { runtimeMeasurements: policy.model, composeManager: composeManagerFixture };
    await expect(options.modelVerification.verifiers.deployment(model)).resolves.toBeUndefined();
    expect(mocks.modelBuild).toHaveBeenCalledWith(model);
    const changed = structuredClone(model); changed.composeManager.actions[0]!.commit = 'f'.repeat(40);
    await expect(options.modelVerification.verifiers.deployment(changed)).rejects.toThrow('INFERENCE_MODEL_DEPLOYMENT');
    mocks.gatewayBuild.mockRejectedValue(new Error('invalid build signature'));
    await expect(options.gatewayVerification.verifiers.deployment({ runtimeMeasurements: policy.gateway })).rejects.toThrow('invalid build signature');
    mocks.modelBuild.mockRejectedValue(new Error('invalid proxy build'));
    await expect(options.modelVerification.verifiers.deployment(model)).rejects.toThrow('invalid proxy build');
  });
});
