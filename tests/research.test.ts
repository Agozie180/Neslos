import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { NATIVE_USDC, normalizeRhea, rankMarkets, researchAgents, ResearchService } from '../src/core/research.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';

describe('NEAR yield evidence', () => {
  it('uses a dated, explicit reference with cited and decomposed rates', async () => {
    const r = await new ResearchService().discover({ referenceOnly: true });
    expect(r.sourceMode).toBe('reference'); expect(r.fetchedAt).toContain('2026-11-01');
    const usdc = r.markets.find(m => m.tokenId === NATIVE_USDC)!;
    expect(usdc.baseApy).toBeGreaterThan(0); expect(usdc.liquidityUsd).toBeGreaterThan(100_000);
    expect(usdc.upstreamObservedAt).toBeNull(); expect(usdc.sourceUrl).toContain('rhea.finance');
    const ranking = rankMarkets(r.markets, DEFAULT_POLICY);
    expect(ranking.filter(m => m.eligible).every(m => m.stablecoin && !m.bridged)).toBe(true);
    expect((await researchAgents(r, DEFAULT_POLICY)).map(a => a.agent)).toEqual(['lending', 'liquidity', 'risk']);
  });
  it('fails closed on malformed data and never turns a negative rate into an opportunity', async () => {
    const fixture = JSON.parse(await readFile('fixtures/rhea-2026-11-01.json', 'utf8'));
    fixture.response.data = fixture.response.data.map((r: object) => ({ ...r, supply_apy: -10 }));
    expect(() => normalizeRhea(fixture.response, 'live', new Date().toISOString())).toThrow();
    expect(() => normalizeRhea({ code: 0, data: [{ token: NATIVE_USDC, supply_apy: 'NaN' }] }, 'live', '')).toThrow();
  });
  it('labels the fallback instead of claiming cached rates are live', async () => {
    const service = new ResearchService(async () => { throw new Error('offline'); });
    const r = await service.discover();
    expect(r.sourceMode).toBe('reference'); expect(r.notices.join(' ')).toContain('unavailable');
  });
  it('has no eligible yield after the owner forbids lending venues', async () => {
    const r = await new ResearchService().discover({ referenceOnly: true });
    expect(rankMarkets(r.markets, { ...DEFAULT_POLICY, allowedVenues: ['near-intents'] }).filter(m => m.eligible)).toHaveLength(0);
  });
  it('does not recognize inherited object properties as supported token IDs', async () => {
    const { response } = JSON.parse(await readFile('fixtures/rhea-2026-11-01.json', 'utf8'));
    const valid = response.data.find((r: { token: string }) => r.token === NATIVE_USDC);
    const result = normalizeRhea({ code: '0', data: [valid, ...['__proto__', 'constructor', 'toString'].map(token => ({ ...valid, token }))] }, 'live', new Date().toISOString());
    expect(result.map(m => m.tokenId)).toEqual([NATIVE_USDC]);
  });
  it('rejects duplicate market identities instead of permitting conflicting research evidence', async () => {
    const { response } = JSON.parse(await readFile('fixtures/rhea-2026-11-01.json', 'utf8'));
    response.data.push({ ...response.data.find((r: { token: string }) => r.token === NATIVE_USDC), base_apy: '100' });
    expect(() => normalizeRhea(response, 'live', new Date().toISOString())).toThrow('DUPLICATE_MARKET');
  });
  it('does not recognize inherited properties as additional NEAR protocols', async () => {
    const { response } = JSON.parse(await readFile('fixtures/rhea-2026-11-01.json', 'utf8'));
    const service = new ResearchService(async url => url.includes('rhea.finance') ? response : { data: [{ project: '__proto__', chain: 'Near', pool: 'fake', symbol: 'FAKE', apy: 5, tvlUsd: 1000000 }] });
    expect((await service.discover()).markets.some(m => m.id === 'llama:fake')).toBe(false);
  });
});
