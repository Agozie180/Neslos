import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentReport, Market, Policy, RankedMarket, ResearchResult } from './types.js';

export const RHEA_SOURCE = 'https://lendingsdk.rhea.finance/list_token_data';
export const LLAMA_SOURCE = 'https://yields.llama.fi/pools';
export const NATIVE_USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const knownTokens: Record<string, { symbol: string; stablecoin: boolean; bridged: boolean }> = {
  [NATIVE_USDC]: { symbol: 'USDC', stablecoin: true, bridged: false },
  'usdt.tether-token.near': { symbol: 'USDT', stablecoin: true, bridged: false },
  'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near': { symbol: 'USDC.e', stablecoin: true, bridged: true },
  'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near': { symbol: 'USDT.e', stablecoin: true, bridged: true },
  '6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near': { symbol: 'DAI', stablecoin: true, bridged: true },
  '853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near': { symbol: 'FRAX', stablecoin: true, bridged: true },
  'wrap.near': { symbol: 'wNEAR', stablecoin: false, bridged: false },
  'meta-pool.near': { symbol: 'stNEAR', stablecoin: false, bridged: false },
  'linear-protocol.near': { symbol: 'LiNEAR', stablecoin: false, bridged: false },
  'lst.rhealab.near': { symbol: 'rNEAR', stablecoin: false, bridged: false },
};

export async function fetchJson(url: string, options: RequestInit = {}, maxBytes = 2_000_000): Promise<unknown> {
  const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(12_000), redirect: 'error', headers: { accept: 'application/json', ...options.headers } });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('Empty provider response.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); throw new Error('Provider response exceeded its size limit.'); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function numeric(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+(\.[0-9]+)?$/.test(value))) throw new Error('Invalid numeric market field.');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid numeric market field.');
  return n;
}

export function normalizeRhea(data: unknown, mode: 'live' | 'reference', fetchedAt: string): Market[] {
  const response = data as { code?: string; data?: unknown[] };
  if (String(response.code) !== '0' || !Array.isArray(response.data)) throw new Error('Invalid Rhea response.');
  const markets: Market[] = [];
  for (const row of response.data) {
    try {
      const r = row as Record<string, unknown>;
      const token = typeof r.token === 'string' ? r.token : '';
      const known = knownTokens[token];
      if (!known) continue;
      const totalApy = numeric(r.supply_apy), baseApy = numeric(r.base_apy), rewardApy = numeric(r.supply_farm_apy);
      const tvlUsd = numeric(r.total_supplied_price), liquidityUsd = numeric(r.available_liquidity_price);
      if (totalApy > 500 || baseApy > 500 || rewardApy > 500 || tvlUsd <= 0 || liquidityUsd > tvlUsd * 1.01) continue;
      const risks = ['Smart-contract and oracle risk.', 'A lending deposit and its position are public.'];
      if (known.stablecoin) risks.push('Stablecoins can lose their peg.');
      else risks.push('Principal has token-price exposure. Native staking yield is not included again.');
      if (known.bridged) risks.push('Additional bridge and wrapped-asset risk.');
      if (liquidityUsd / tvlUsd < 0.15) risks.push('High utilization can constrain withdrawals.');
      markets.push({ id: `rhea:${token}`, protocol: 'Rhea Finance', venue: 'rhea-lending', tokenId: token, chain: 'NEAR', totalApy, baseApy, rewardApy, tvlUsd, liquidityUsd, utilization: Math.max(0, 1 - liquidityUsd / tvlUsd), ...known, sourceUrl: RHEA_SOURCE, sourceMode: mode, fetchedAt, upstreamObservedAt: null, risks });
    } catch { /* An invalid row never becomes an actionable market. */ }
  }
  if (!markets.length) throw new Error('No supported, valid Rhea markets were returned.');
  return markets;
}

function normalizeLlama(data: unknown, fetchedAt: string): Market[] {
  const projects: Record<string, { name: string; venue: string }> = { 'ref-finance': { name: 'Rhea DEX', venue: 'rhea-dex' }, 'meta-pool': { name: 'Meta Pool', venue: 'meta-pool' }, 'linear-protocol': { name: 'LiNEAR', venue: 'linear' } };
  const records = (data as { data?: unknown[] }).data;
  if (!Array.isArray(records)) throw new Error('Invalid DeFiLlama response.');
  return records.flatMap(row => {
    try {
      const r = row as Record<string, unknown>;
      const project = projects[String(r.project)];
      if (String(r.chain).toLowerCase() !== 'near' || !project || typeof r.pool !== 'string' || typeof r.symbol !== 'string' || r.symbol.length > 40) return [];
      const totalApy = numeric(r.apy), baseApy = numeric(r.apyBase ?? r.apy), rewardApy = numeric(r.apyReward ?? 0), tvlUsd = numeric(r.tvlUsd);
      if (totalApy > 500 || tvlUsd <= 0) return [];
      return [{ id: `llama:${r.pool}`, protocol: project.name, venue: project.venue, symbol: r.symbol, tokenId: '', chain: 'NEAR' as const, totalApy, baseApy, rewardApy, tvlUsd, liquidityUsd: 0, utilization: 0, stablecoin: r.stablecoin === true, bridged: false, sourceUrl: `https://defillama.com/yields/pool/${encodeURIComponent(r.pool)}`, sourceMode: 'live' as const, fetchedAt, upstreamObservedAt: null, risks: ['Research only: exit liquidity and an execution adapter are not verified.', 'APY is aggregator-reported; underlying positions remain public.', ...(r.ilRisk === 'yes' ? ['Impermanent-loss risk.'] : [])] }];
    } catch { return []; }
  }).slice(0, 24);
}

export class ResearchService {
  private cached?: ResearchResult;
  private cachedAt = 0;
  private inflight?: Promise<ResearchResult>;
  constructor(private fetcher = fetchJson, private fixturePath = resolve('fixtures/rhea-2026-11-01.json')) {}
  async discover(options: { referenceOnly?: boolean; refresh?: boolean; broad?: boolean } = {}): Promise<ResearchResult> {
    if (options.referenceOnly) return this.reference('Reference dataset selected; these are captured rates, not current quotes.');
    if (!options.refresh && this.cached && Date.now() - this.cachedAt < 60_000) return structuredClone(this.cached);
    if (this.inflight) return structuredClone(await this.inflight);
    this.inflight = this.live(options.broad ?? true);
    try { const result = await this.inflight; this.cached = result; this.cachedAt = Date.now(); return structuredClone(result); }
    finally { this.inflight = undefined; }
  }
  private async live(broad: boolean): Promise<ResearchResult> {
    const results = await Promise.allSettled([this.fetcher(RHEA_SOURCE), ...(broad ? [this.fetcher(LLAMA_SOURCE, { signal: AbortSignal.timeout(12_000) }, 64_000_000)] : [])]);
    const fetchedAt = new Date().toISOString();
    const primary = results[0]!;
    let result: ResearchResult;
    try {
      if (primary.status === 'rejected') throw primary.reason;
      result = { markets: normalizeRhea(primary.value, 'live', fetchedAt), sourceMode: 'live', sourceUrl: RHEA_SOURCE, fetchedAt, upstreamObservedAt: null, notices: ['Rates are provider-reported, variable and not guaranteed. Rhea does not include an observation timestamp in this endpoint.'] };
    } catch { result = await this.reference('The live Rhea feed is unavailable or invalid; using the explicitly labelled 1 November reference snapshot.'); }
    const secondary = results[1];
    if (secondary?.status === 'fulfilled') {
      try { const markets = normalizeLlama(secondary.value, fetchedAt); result.markets.push(...markets); if (markets.length) result.notices.push('Additional NEAR protocols are from DeFiLlama and are research-only until exit liquidity and execution are verified.'); }
      catch { result.notices.push('Broader NEAR coverage could not be validated.'); }
    } else if (broad) result.notices.push('Broader DeFiLlama coverage is unavailable; the actionable comparison covers Rhea lending.');
    return result;
  }
  private async reference(notice: string): Promise<ResearchResult> {
    const fixture = JSON.parse(await readFile(this.fixturePath, 'utf8')) as { response: unknown; retrievedDate: string };
    return { markets: normalizeRhea(fixture.response, 'reference', fixture.retrievedDate), sourceMode: 'reference', sourceUrl: RHEA_SOURCE, fetchedAt: fixture.retrievedDate, upstreamObservedAt: null, notices: [notice, 'This snapshot is suitable for a rehearsal, not a funded trading decision.'] };
  }
}

export function rankMarkets(markets: Market[], policy: Policy): RankedMarket[] {
  return markets.map(m => {
    const exclusions: string[] = [];
    if (!policy.allowedVenues.includes(m.venue)) exclusions.push('Venue is outside the policy.');
    if (policy.stablecoinsOnly && !m.stablecoin) exclusions.push('Policy allows stablecoins only.');
    if (!policy.allowBridgedAssets && m.bridged) exclusions.push('Policy excludes bridged assets.');
    if (!m.tokenId || m.id.startsWith('llama:')) exclusions.push('Research-only adapter.');
    if (m.liquidityUsd <= 0 || m.liquidityUsd < policy.minimumLiquidityUsd) exclusions.push('Insufficient verified exit liquidity.');
    // A transparent ranking heuristic, not a statistical risk model or predicted return.
    const score = m.baseApy + m.rewardApy * 0.25 - (m.bridged ? 3 : 0) - (m.utilization > 0.9 ? 2 : 0);
    return { ...m, eligible: exclusions.length === 0, exclusions, score: Math.round(score * 100) / 100 };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.id.localeCompare(b.id));
}

export async function researchAgents(research: ResearchResult, policy: Policy): Promise<AgentReport[]> {
  const ranked = rankMarkets(research.markets, policy);
  const eligible = ranked.filter(m => m.eligible);
  const sources = [...new Set(research.markets.map(m => m.sourceUrl))];
  const completedAt = new Date().toISOString();
  return Promise.all([
    Promise.resolve({ agent: 'lending' as const, title: 'Yield discovery', summary: `${research.markets.length} NEAR markets examined; ${eligible.length} match your policy.`, findings: [eligible[0] ? `${eligible[0].protocol} ${eligible[0].symbol} leads eligible observed opportunities at ${eligible[0].totalApy.toFixed(2)}% reported APY.` : 'No verified market satisfies the current policy.', 'Base yield is separated from token incentives.', 'A reserve allocation does not open a lending position.'], marketIds: ranked.slice(0, 6).map(m => m.id), sourceUrls: sources, completedAt, inference: 'deterministic' as const }),
    Promise.resolve({ agent: 'liquidity' as const, title: 'Exit-liquidity review', summary: `A $${policy.minimumLiquidityUsd.toLocaleString('en-US')} exit-liquidity floor is applied.`, findings: [eligible[0] ? `Leading pool reports $${Math.round(eligible[0].liquidityUsd).toLocaleString('en-US')} available liquidity.` : 'No eligible verified exit liquidity.', 'TVL alone is not treated as available withdrawal liquidity.', 'Provider data is fetched now; upstream observation time is not supplied.'], marketIds: eligible.map(m => m.id), sourceUrls: sources, completedAt, inference: 'deterministic' as const }),
    Promise.resolve({ agent: 'risk' as const, title: 'Independent risk review', summary: `${ranked.filter(m => !m.eligible).length} opportunities excluded by explicit rules.`, findings: [policy.allowBridgedAssets ? 'Bridge exposure is permitted by the owner.' : 'Bridged-asset exposure is excluded.', 'Stablecoin depeg, contract and oracle risks still apply.', 'Private settlement does not make a public DeFi position confidential.'], marketIds: ranked.filter(m => !m.eligible).map(m => m.id), sourceUrls: sources, completedAt, inference: 'deterministic' as const }),
  ]);
}
