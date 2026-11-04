import { describe, expect, it } from 'vitest';
import { checkInferenceBudget, DISABLED_INFERENCE_BUDGET, estimateInference, inferenceUsage } from '../src/core/inference-budget.js';
import { selectStrategy } from '../src/core/strategy.js';
import type { AgentReport, RankedMarket } from '../src/core/types.js';

const ranking = [{ id: 'high', eligible: true, exclusions: [], score: 10 }, { id: 'lower', eligible: true, exclusions: [], score: 5 }, { id: 'prohibited', eligible: false, exclusions: ['Outside the owner policy.'], score: 100 }] as RankedMarket[];
function reports(): AgentReport[] { return ['lending', 'liquidity', 'risk'].map(agent => ({ agent, assessments: ranking.map(m => ({ marketId: m.id, decision: 'approve', reason: 'Observed evidence reviewed.' })) })) as AgentReport[]; }
describe('research affects strategy within deterministic authority', () => {
  it('selects a lower-ranked market when the risk researcher rejects the leader', () => {
    const reviews = reports(); reviews[2]!.assessments![0]!.decision = 'reject'; reviews[2]!.assessments![0]!.reason = 'Liquidity evidence is too weak.';
    expect(selectStrategy(ranking, reviews)).toMatchObject({ selectedMarketId: 'lower', baselineMarketId: 'high', changedByResearch: true });
  });
  it('cannot approve a prohibited market even with unanimous model approval', () => {
    const decision = selectStrategy(ranking, reports());
    expect(decision.selectedMarketId).toBe('high'); expect(decision.candidates[2]!.approved).toBe(false);
  });
  it('missing assessments and abstentions never count as consent', () => {
    const reviews = reports(); reviews[0]!.assessments = [];
    expect(selectStrategy(ranking, reviews).selectedMarketId).toBeNull();
    expect(() => selectStrategy(ranking, reviews.slice(1))).toThrow('RESEARCH_QUORUM');
  });
  it('rejects fabricated and duplicated market evidence', () => {
    const reviews = reports(); reviews[0]!.assessments!.push({ marketId: 'invented', decision: 'approve', reason: 'Invented' });
    expect(() => selectStrategy(ranking, reviews)).toThrow('RESEARCH_EVIDENCE');
  });
});
const limits = { ...DISABLED_INFERENCE_BUDGET, totalLimitNanoUsd: '100000000', dailyLimitNanoUsd: '20000000', maxCalls: 6, inputNanoUsdPerToken: '80', outputNanoUsdPerToken: '500' };
describe('credit preservation before paid inference', () => {
  it('defaults to zero paid requests and rejects oversized prompts', () => {
    expect(() => estimateInference('model', [{}], DISABLED_INFERENCE_BUDGET)).toThrow('DISABLED');
    expect(() => estimateInference('model', [{ text: 'x'.repeat(25000) }], limits)).toThrow('INPUT_LIMIT');
  });
  it('reserves maximum output and a conservative byte bound before calls', () => {
    const reservation = estimateInference('model', [{ prompt: 'é' }, {}, {}], limits);
    expect(reservation.calls).toBe(3); expect(reservation.inputTokensBound).toBeGreaterThan(3 * 4096);
    expect(reservation.outputTokensBound).toBe(2400);
    expect(BigInt(reservation.reservedNanoUsd)).toBe(BigInt(reservation.inputTokensBound) * 80n + 2400n * 500n);
  });
  it('retains unknown/failed requests across reload and enforces lifetime call count', () => {
    const reservation = estimateInference('model', [{}, {}, {}], limits);
    const persisted = JSON.parse(JSON.stringify([reservation, reservation]));
    expect(() => checkInferenceBudget(persisted, reservation, limits)).toThrow('EXHAUSTED');
    expect(inferenceUsage(persisted).calls).toBe(6);
  });
  it('a new day resets only the daily counter, preserving the lifetime ceiling', () => {
    const reservation = { ...estimateInference('model', [{}], limits), createdAt: '2020-01-01T00:00:00.000Z' };
    expect(inferenceUsage([reservation])).toMatchObject({ dayNanoUsd: '0', totalNanoUsd: reservation.reservedNanoUsd, calls: 1 });
    expect(() => checkInferenceBudget([reservation], reservation, { ...limits, totalLimitNanoUsd: reservation.reservedNanoUsd })).toThrow('EXHAUSTED');
  });
});
