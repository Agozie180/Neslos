import { z } from 'zod';
import type { AgentReport, RankedMarket } from './types.js';

export const assessmentSchema = z.object({
  marketId: z.string().min(1).max(160),
  decision: z.enum(['approve', 'reject', 'abstain']),
  reason: z.string().min(1).max(400),
}).strict();
export type MarketAssessment = z.infer<typeof assessmentSchema>;
export interface StrategyDecision {
  selectedMarketId: string | null;
  baselineMarketId: string | null;
  changedByResearch: boolean;
  candidates: { marketId: string; approved: boolean; reasons: string[] }[];
}
const roles = ['lending', 'liquidity', 'risk'] as const;

/** Models can narrow the deterministic allowlist, never expand it or change amounts. */
export function selectStrategy(ranking: RankedMarket[], reports: AgentReport[]): StrategyDecision {
  const reviewers = roles.map(role => {
    const matches = reports.filter(report => report.agent === role);
    if (matches.length !== 1) throw new Error('RESEARCH_QUORUM: one report per research role is required.');
    const assessments = z.array(assessmentSchema).max(12).parse(matches[0]!.assessments ?? []);
    if (new Set(assessments.map(a => a.marketId)).size !== assessments.length || assessments.some(a => !ranking.some(m => m.id === a.marketId))) throw new Error('RESEARCH_EVIDENCE: duplicate or unknown market assessment.');
    return { role, assessments };
  });
  const candidates = ranking.map(market => {
    const reasons = [...market.exclusions];
    for (const { role, assessments } of reviewers) {
      const assessment = assessments.find(a => a.marketId === market.id);
      if (!assessment || assessment.decision !== 'approve') reasons.push(`${role}: ${assessment?.reason ?? 'No explicit approval for this market.'}`);
    }
    return { marketId: market.id, approved: market.eligible && reasons.length === 0, reasons };
  });
  const baselineMarketId = ranking.find(m => m.eligible)?.id ?? null;
  const selectedMarketId = candidates.find(m => m.approved)?.marketId ?? null;
  return { selectedMarketId, baselineMarketId, changedByResearch: selectedMarketId !== baselineMarketId, candidates };
}
