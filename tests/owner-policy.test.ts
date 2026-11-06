import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { commitment } from '../src/core/crypto.js';
import { readVault } from '../src/core/near.js';
import type { ChainPolicy } from '../src/core/wire.js';
import { changeAllowlists, ownerAllowlists, ownerOpeningsSchema } from '../src/owner/policy.js';
import { writePrivateJson } from '../src/owner/account.js';
import { OwnerWorkspace } from '../src/owner/workspace.js';
vi.mock('../src/core/near.js', async original => ({ ...await original<typeof import('../src/core/near.js')>(), readVault: vi.fn() }));
const openings = { venues: [{ name: 'near-intents' as const, salt: 'ab'.repeat(32) }, { name: 'rhea-lending' as const, salt: 'cd'.repeat(32) }],
  counterparties: [{ name: 'Treasury', recipient: 'treasury.near', salt: 'ef'.repeat(32) }, { name: 'Research partner', recipient: 'research.near', salt: '12'.repeat(32) }] };
const policy: ChainPolicy = { daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, max_quote_age_ms: '60000',
  venue_commitments: openings.venues.map(v => commitment('venue', v.name, v.salt)), counterparty_commitments: [commitment('counterparty', openings.counterparties[0]!.recipient, openings.counterparties[0]!.salt)],
  output_assets: ['nep141:usdt.tether-token.near'], require_confidential: true, paused: false };
const request = { dailyLimit: '400000000', perActionLimit: '150000000', maxSlippageBps: 25, requireConfidential: true, outputAssets: policy.output_assets };

describe('owner allowlist governance', () => {
  it('shows on-chain membership without exposing salts', () => {
    const view = ownerAllowlists(policy, openings);
    expect(view).toMatchObject({ venuesComplete: true, counterpartiesComplete: true, counterparties: [{ name: 'Treasury', allowed: true }, { name: 'Research partner', allowed: false }] });
    expect(JSON.stringify(view)).not.toContain(openings.venues[0]!.salt);
    expect(JSON.stringify(view)).not.toContain(openings.counterparties[0]!.salt);
  });
  it('changes only selected lists and derives exact commitments from local openings', () => {
    expect(changeAllowlists(policy, openings, { allowedVenues: ['near-intents'] })).toEqual({ venue_commitments: [policy.venue_commitments[0]], counterparty_commitments: policy.counterparty_commitments });
    expect(changeAllowlists(policy, openings, { allowedCounterparties: ['Research partner'] }).counterparty_commitments).toEqual([commitment('counterparty', 'research.near', '12'.repeat(32))]);
  });
  it.each([{ allowedVenues: [] }, { allowedVenues: ['near-intents', 'near-intents'] }, { allowedCounterparties: ['Unknown recipient'] }])('refuses empty, duplicate or unknown selections: %j', input => {
    expect(() => changeAllowlists(policy, openings, input)).toThrow();
  });
  it('cannot silently remove members whose private details are missing locally', () => {
    const missing = { ...policy, counterparty_commitments: ['ff'.repeat(32)] };
    expect(ownerAllowlists(missing, openings).counterpartiesComplete).toBe(false);
    expect(() => changeAllowlists(missing, openings, { allowedCounterparties: ['Treasury'] })).toThrow('POLICY_OPENINGS_INCOMPLETE');
    expect(changeAllowlists(missing, openings, { allowedVenues: ['near-intents'] }).counterparty_commitments).toEqual(missing.counterparty_commitments);
  });
  it('refuses ambiguous local member names', () => {
    expect(() => ownerOpeningsSchema.parse({ ...openings, venues: [...openings.venues, openings.venues[0]] })).toThrow();
  });
  it('produces an exact version-bound policy plan and rejects a concurrent change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'neslos-policy-'));
    const measurement = 'aa'.repeat(48);
    await writePrivateJson(join(directory, 'runtime.json'), { format: 'neslos-owner-runtime-v1', endpoint: 'https://fixture.invalid', network: 'testnet', vault: 'vault.testnet', executorPublicKey: 'bb'.repeat(32),
      teePolicy: { format: 'neslos-tdx-policy-v1', mrTd: measurement, rtMr0: measurement, rtMr1: measurement, rtMr2: measurement, rtMr3: measurement } });
    await writePrivateJson(join(directory, 'openings.json'), openings);
    const state = { config: { owner_id: 'owner.testnet', policy, policy_version: '7' }, budget: { used: '150000000', next_nonce: '2' } } as Awaited<ReturnType<typeof readVault>>;
    vi.mocked(readVault).mockResolvedValue(state);
    const workspace = new OwnerWorkspace(directory);
    const plan = await workspace.policyPlan({ ...request, allowedVenues: ['near-intents'], allowedCounterparties: ['Treasury', 'Research partner'] });
    const call = plan.call.actions[0]!.params;
    expect(call.methodName).toBe('set_policy');
    expect(call.args).toMatchObject({ expected_version: '7', policy: { daily_limit: '400000000', venue_commitments: [policy.venue_commitments[0]], counterparty_commitments: [policy.counterparty_commitments[0], commitment('counterparty', 'research.near', '12'.repeat(32))] } });
    expect(JSON.stringify(plan)).not.toContain(openings.counterparties[0]!.salt);
    expect(call.args).not.toHaveProperty('used'); expect(call.args).not.toHaveProperty('next_nonce');
    vi.mocked(readVault).mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, config: { ...state.config, policy_version: '8' } });
    await expect(workspace.policyPlan(request)).rejects.toThrow('PLAN_STATE_CHANGED');
  });
});
