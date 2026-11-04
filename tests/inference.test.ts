import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), options: vi.fn(), reserve: vi.fn() }));
vi.mock('@nearai/inference-sdk/node', () => ({ InferenceClient: class {
  constructor(options: unknown) { mocks.options(options); }
  chat = { completions: { create: mocks.create } }; verifyResponse = mocks.verify;
} }));
import { PrivateResearchers } from '../src/core/inference.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
import type { ResearchResult } from '../src/core/types.js';

const policy = { modelId: 'test-model', gateway: { osImageHash: 'aa'.repeat(32), composeHash: 'bb'.repeat(32) }, model: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32) }, budget: { totalLimitNanoUsd: '100000000', dailyLimitNanoUsd: '20000000', maxCalls: 6, inputNanoUsdPerToken: '80', outputNanoUsdPerToken: '500' } };
const evidence: ResearchResult = { sourceMode: 'live', fetchedAt: new Date().toISOString(), upstreamObservedAt: null, sourceUrl: 'https://fixture.invalid', notices: [], markets: [{ id: 'rhea:token.near', tokenId: 'token.near', protocol: 'Rhea', venue: 'rhea-lending', symbol: 'USDC', chain: 'NEAR', totalApy: 4, baseApy: 4, rewardApy: 0, tvlUsd: 2000000, liquidityUsd: 1000000, utilization: 0.5, stablecoin: true, bridged: false, sourceUrl: 'https://fixture.invalid', sourceMode: 'live', fetchedAt: new Date().toISOString(), upstreamObservedAt: null, risks: [] }] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.reserve.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: 'test-completion', choices: [{ message: { content: JSON.stringify({ summary: 'Eligible market reviewed.', findings: ['Observed evidence'], marketIds: ['rhea:token.near'], assessments: [{ marketId: 'rhea:token.near', decision: 'approve', reason: 'Reported liquidity is sufficient.' }] }) } }] });
  mocks.verify.mockResolvedValue({ signatureKind: 'provider_tee' });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ models: [{ modelId: 'test-model', inputCostPerToken: { amount: 80, scale: 9, currency: 'USD' }, outputCostPerToken: { amount: 500, scale: 9, currency: 'USD' }, metadata: { verifiable: true, attestationSupported: true, providerType: 'vllm' } }] })));
});
afterEach(() => vi.unstubAllGlobals());
describe('NEAR AI researcher orchestration with fixture SDK responses', () => {
  it('requires encrypted inference, fresh attestations and approved gateway/model measurements', async () => {
    const researchers = new PrivateResearchers(policy, 'fixture-only', mocks.reserve);
    const options = mocks.options.mock.calls[0]![0];
    expect(options).toMatchObject({ e2ee: true, attestationCacheTimeToLiveMs: 0, gatewayVerification: { includeSpkiFingerprint: true }, modelVerification: { policy: { gpuEvidence: 'required', acceptedTcbStatuses: ['UpToDate'] } } });
    expect(() => options.deploymentPolicy({ model: 'wrong', deployment: {} })).toThrow('Unapproved');
    expect(() => options.gatewayVerification.verifiers.deployment({ runtimeMeasurements: policy.model })).toThrow('INFERENCE_MEASUREMENT');
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
});
