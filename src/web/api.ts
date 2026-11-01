import type { AuditExport, BudgetSnapshot, MissionRequest, MissionRun, Policy, RankedMarket, ResearchResult } from '../core/types.js';
export interface AppState {
  sessionId: string; csrf: string; mode: 'rehearsal'; policy: Policy; budget: BudgetSnapshot; runs: MissionRun[]; audit: AuditExport;
  integrations: { marketData: string; contractBuilt: boolean; tee: string; inference: string; confidentialQuotes: string; chain: string; settlement: string };
}
export type MarketResponse = ResearchResult & { ranking: RankedMarket[] };
export async function request<T>(path: string, method = 'GET', body?: unknown, csrf?: string): Promise<T> {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', signal: AbortSignal.timeout(25_000), headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-Neslos-CSRF': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data as T;
}
export function launchMission(input: MissionRequest, csrf: string) { return request<{ run: MissionRun }>('/runs', 'POST', input, csrf); }
export function savePolicy(policy: Policy, expectedVersion: number, csrf: string) { return request<AppState>('/policy', 'PATCH', { policy, expectedVersion }, csrf); }
