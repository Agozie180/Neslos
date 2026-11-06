import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), verify: vi.fn(), vault: vi.fn(), record: vi.fn(), research: vi.fn(), reports: vi.fn(), quote: vi.fn(), status: vi.fn(), reserve: undefined as undefined | ((reservation: import('../src/core/inference-budget.js').InferenceReservation) => Promise<void>) }));
vi.mock('../src/core/attestation.js', async original => ({ ...await original<typeof import('../src/core/attestation.js')>(), createTeeIdentity: mocks.identity, verifyTeeEvidence: mocks.verify }));
vi.mock('../src/core/near.js', () => ({ readVault: mocks.vault, viewNear: mocks.record }));
vi.mock('../src/core/research.js', async original => ({ ...await original<typeof import('../src/core/research.js')>(), ResearchService: class { discover = mocks.research; } }));
vi.mock('../src/core/inference.js', async original => ({ ...await original<typeof import('../src/core/inference.js')>(), PrivateResearchers: class {
  constructor(_policy: unknown, _key: string, reserve: typeof mocks.reserve) { mocks.reserve = reserve; }
  research = mocks.reports;
} }));
vi.mock('../src/core/intents.js', async original => ({ ...await original<typeof import('../src/core/intents.js')>(), IntentsClient: class { quote = mocks.quote; status = mocks.status; } }));
import { PrivateRuntime, type prepareSchema } from '../src/tee/runtime.js';
import { AuditJournal } from '../src/tee/journal.js';
import { channelSuite, decryptChannel, encryptChannel } from '../src/core/channel.js';
import { canonical, commitment, keyFromSeed, sha256, verifyHash } from '../src/core/crypto.js';
import { NATIVE_USDC } from '../src/core/research.js';
import { quoteFixture } from './fixtures/quote.js';
import { authorizationBytes, settlementBytes } from '../src/core/wire.js';
import { verifyAudit } from '../src/core/audit.js';
import { DISABLED_INFERENCE_BUDGET, type InferenceBudgetPolicy } from '../src/core/inference-budget.js';
import { privateCommand } from '../src/core/private-client.js';
import { downloadPrivateAudit, openPrivateReceipt, runPrivateJob, type OwnerRuntime } from '../src/owner/private.js';
import type { TeeIdentity, TeePolicy } from '../src/core/attestation.js';
import type { z } from 'zod';

// Only the external services/hardware boundary are fixtures. Encryption, signing,
// command validation, queueing and disk journals below run the production code.
const salt = '11'.repeat(32), token = '22'.repeat(32);
const teePolicy: TeePolicy = { format: 'neslos-tdx-policy-v1', mrTd: '33'.repeat(48), rtMr0: '44'.repeat(48), rtMr1: '55'.repeat(48), rtMr2: '66'.repeat(48), rtMr3: '77'.repeat(48) };
let directory: string, identity: TeeIdentity;
const command = (): z.infer<typeof prepareSchema> => ({ type: 'prepare', id: randomUUID(), prompt: 'Compare stablecoin yields', amount: '150000000', kind: 'allocation-reserve', counterparty: { recipient: 'recipient.near', salt }, venues: [{ name: 'near-intents', salt }, { name: 'rhea-lending', salt }], research: { stablecoinsOnly: true, allowBridgedAssets: false, minimumLiquidityUsd: 100000 } });
function state() {
  return {
    config: { owner_id: 'owner.near', token_id: NATIVE_USDC, network: 'mainnet', executor_public_key: identity.executorPublicKey, policy_version: '1', policy: {
      daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, max_quote_age_ms: '60000', paused: false, require_confidential: true,
      venue_commitments: ['near-intents', 'rhea-lending'].map(name => commitment('venue', name, salt)), counterparty_commitments: [commitment('counterparty', 'recipient.near', salt)], output_assets: ['nep141:usdt.tether-token.near'],
    } },
    budget: { day: String(Math.floor(Date.now() / 86400000)), next_nonce: '0', used: '0', remaining: '500000000', policy_version: '1', paused: false }, balance: '1000000000', blockHash: 'fixture-block', blockHeight: 1,
  };
}
function evidence() {
  return { sourceMode: 'live', fetchedAt: new Date().toISOString(), sourceUrl: 'https://synthetic.invalid', upstreamObservedAt: null, notices: [], markets: [
    [NATIVE_USDC, 'USDC', 10], ['usdt.tether-token.near', 'USDT', 5],
  ].map(([tokenId, symbol, rate]) => ({ id: 'rhea:' + tokenId, tokenId, symbol, protocol: 'Rhea Finance', venue: 'rhea-lending', chain: 'NEAR', baseApy: rate, rewardApy: 0, totalApy: rate, tvlUsd: 2000000, liquidityUsd: 1000000, utilization: 0.5, stablecoin: true, bridged: false, sourceMode: 'live', sourceUrl: 'https://synthetic.invalid', fetchedAt: new Date().toISOString(), upstreamObservedAt: null, risks: [] })) };
}
function create(journalPath = join(directory, 'audit.json'), budget: InferenceBudgetPolicy = DISABLED_INFERENCE_BUDGET) {
  return PrivateRuntime.create({ network: 'mainnet', vault: 'vault.near', teePolicy, inferencePolicy: { modelId: 'fixture', gateway: { osImageHash: 'aa'.repeat(32), composeHash: 'bb'.repeat(32) }, model: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32) }, budget }, ownerToken: token, nearAiKey: 'fixture', journalPath });
}
async function send(runtime: PrivateRuntime, request: unknown, ownerToken = token) {
  const nonce = randomBytes(32).toString('hex'), keys = await channelSuite.GenerateKeyPair();
  const replyKey = Buffer.from(await channelSuite.SerializePublicKey(keys.publicKey)).toString('hex');
  const envelope = await encryptChannel(identity.transportPublicKey, { ownerToken, command: request, replyKey, expiresAt: Date.now() + 60000 }, { domain: 'neslos:request:v1', nonce });
  const reply = await runtime.handle(nonce, envelope);
  expect(verifyHash(sha256(canonical({ nonce, envelope: reply.envelope })), reply.signature, identity.executorPublicKey)).toBe(true);
  return await decryptChannel(keys, reply.envelope, { domain: 'neslos:response:v1', nonce }) as { ok: boolean; value: any; error?: string };
}
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'neslos-runtime-'));
  const signingSeed = randomBytes(32), pair = keyFromSeed(signingSeed), channelKeys = await channelSuite.GenerateKeyPair();
  identity = { signingSeed, signingKey: pair.privateKey, executorPublicKey: pair.publicKey, auditKey: randomBytes(32), channelKeys, transportPublicKey: Buffer.from(await channelSuite.SerializePublicKey(channelKeys.publicKey)).toString('hex'), attest: async nonce => ({ format: 'neslos-tdx-evidence-v1', nonce, executorPublicKey: pair.publicKey, transportPublicKey: identity.transportPublicKey, quote: '00'.repeat(400), eventLog: '[]' }) };
  mocks.identity.mockResolvedValue(identity); mocks.verify.mockResolvedValue({ verified: true, executorPublicKey: identity.executorPublicKey, transportPublicKey: identity.transportPublicKey });
  mocks.vault.mockImplementation(async () => state()); mocks.research.mockImplementation(async () => evidence());
  mocks.reports.mockImplementation(async () => ['lending', 'liquidity', 'risk'].map(agent => ({ agent, title: agent, summary: 'Fixture review', findings: ['Fixture evidence'], marketIds: evidence().markets.map(m => m.id), sourceUrls: [], completedAt: new Date().toISOString(), inference: 'verified-near-ai', assessments: evidence().markets.map(m => ({ marketId: m.id, decision: 'approve', reason: 'Fixture review passed.' })) })));
  mocks.quote.mockImplementation(async () => { const response = quoteFixture(); return { response, hash: sha256(canonical(response)), signatureVerified: true, privacyBinding: 'signed-confidential-recipient', requestedSlippageBps: 49, enforcedSlippageBps: 50, fetchedAt: new Date().toISOString() }; });
  mocks.status.mockResolvedValue({ outcome: 'pending', raw: { status: 'KNOWN_DEPOSIT_TX' } });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
describe('encrypted private runtime', () => {
  const budget: InferenceBudgetPolicy = { ...DISABLED_INFERENCE_BUDGET, totalLimitNanoUsd: '1000', dailyLimitNanoUsd: '1000', maxCalls: 3, inputNanoUsdPerToken: '1', outputNanoUsdPerToken: '1' };
  const reservation = () => ({ id: randomUUID(), modelId: 'fixture', createdAt: new Date().toISOString(), calls: 3, inputTokensBound: 100, outputTokensBound: 200, reservedNanoUsd: '300', requestHash: 'ab'.repeat(32) });
  it('keeps its approved credit ceiling when the caller mutates the original options', async () => {
    const suppliedBudget = { ...budget, totalLimitNanoUsd: '300', dailyLimitNanoUsd: '300' };
    const report = mocks.reports.getMockImplementation()!;
    mocks.reports.mockImplementation(async () => { await mocks.reserve!(reservation()); return report(); });
    const runtime = await create(undefined, suppliedBudget);
    suppliedBudget.totalLimitNanoUsd = '1000'; suppliedBudget.dailyLimitNanoUsd = '1000'; suppliedBudget.maxCalls = 9;
    const { amount: _amount, kind: _kind, counterparty: _counterparty, ...request } = command();
    expect((await send(runtime, { ...request, type: 'research' })).ok).toBe(true);
    expect((await send(runtime, { ...request, type: 'research', id: randomUUID() })).error).toContain('INFERENCE_BUDGET_EXHAUSTED');
    expect((await send(runtime, { type: 'status', id: randomUUID() })).value.inference).toMatchObject({
      totalNanoUsd: '300', calls: 3, limits: { totalLimitNanoUsd: '300', dailyLimitNanoUsd: '300', maxCalls: 3 },
    });
  });
  it('retains paid failures and credit usage across restart without another paid attempt', async () => {
    mocks.reports.mockImplementation(async () => { await mocks.reserve!(reservation()); throw new Error('PRIVATE_RESEARCH_FAILED'); });
    const request = command();
    expect((await send(await create(undefined, budget), request)).error).toContain('PRIVATE_RESEARCH_FAILED');
    const restarted = await create(undefined, budget);
    expect((await send(restarted, request)).error).toContain('PRIVATE_RESEARCH_FAILED');
    expect(mocks.reports).toHaveBeenCalledTimes(1);
    expect((await send(restarted, { type: 'status', id: randomUUID() })).value.inference).toMatchObject({ calls: 3, totalNanoUsd: '300' });
    expect((await send(restarted, command())).error).toContain('INFERENCE_BUDGET_EXHAUSTED');
    expect((await send(restarted, { type: 'status', id: randomUUID() })).value.inference.totalNanoUsd).toBe('300');
  });
  it('binds an interrupted paid attempt to its exact command before sending inference', async () => {
    mocks.reports.mockImplementation(async () => {
      await mocks.reserve!(reservation());
      // Simulate losing durable writes after the reservation, before any outcome.
      const { mkdir } = await import('node:fs/promises'); await mkdir(join(directory, 'audit.json.pending'));
      throw new Error('transport interrupted');
    });
    const request = command();
    expect((await send(await create(undefined, budget), request)).ok).toBe(false);
    await rm(join(directory, 'audit.json.pending'), { recursive: true });
    const restarted = await create(undefined, budget);
    expect((await send(restarted, request)).error).toContain('INFERENCE_OUTCOME_UNKNOWN');
    expect((await send(restarted, { ...request, prompt: 'A different mission' })).error).toContain('IDEMPOTENCY_CONFLICT');
    expect(mocks.reports).toHaveBeenCalledTimes(1);
    expect((await send(restarted, { type: 'status', id: randomUUID() })).value.inference.totalNanoUsd).toBe('300');
  });
  it('selects an allowed lower-ranked asset and emits an exact verifiable authorization', async () => {
    const runtime = await create(), result = await send(runtime, command());
    expect(result.ok, result.error).toBe(true);
    expect(mocks.quote).toHaveBeenCalledWith(expect.objectContaining({ destinationAsset: 'nep141:usdt.tether-token.near' }));
    const { signed, transaction } = result.value;
    expect(verifyHash(sha256(authorizationBytes(signed.authorization)), signed.signature, identity.executorPublicKey)).toBe(true);
    expect(transaction.actions[0].params.args.authorization).toEqual(signed.authorization);
    expect(signed.authorization.amount).toBe('150000000');
    const raw = await readFile(join(directory, 'audit.json'), 'utf8');
    expect(raw).not.toContain('recipient.near');
    const bundle = await new AuditJournal(join(directory, 'audit.json'), identity.executorPublicKey).load();
    expect(verifyAudit(bundle!, identity.executorPublicKey).valid).toBe(true);
  });
  it('rejects allocation when no market has an allowed output asset', async () => {
    const current = state(); current.config.policy.output_assets = ['nep141:other.near']; mocks.vault.mockResolvedValue(current);
    const result = await send(await create(), command());
    expect(result.ok).toBe(false); expect(result.error).toContain('NO_ELIGIBLE_MARKET'); expect(mocks.quote).not.toHaveBeenCalled();
  });
  it.each(['executor', 'counterparty', 'paused', 'amount', 'inference', 'reference'])('rejects %s before preparing a quote', async failure => {
    const current = state(), request = command();
    if (failure === 'executor') current.config.executor_public_key = 'ff'.repeat(32);
    if (failure === 'counterparty') request.counterparty.recipient = 'attacker.near';
    if (failure === 'paused') current.config.policy.paused = true;
    if (failure === 'amount') request.amount = '200000001';
    if (failure === 'inference') mocks.reports.mockRejectedValue(new Error('PRIVATE_RESEARCH_FAILED'));
    if (failure === 'reference') mocks.research.mockResolvedValue({ ...evidence(), sourceMode: 'reference' });
    mocks.vault.mockResolvedValue(current);
    expect((await send(await create(), request)).ok).toBe(false); expect(mocks.quote).not.toHaveBeenCalled();
  });
  it.each(['policy', 'nonce'])('rejects a %s change during quote acquisition', async field => {
    const first = state(), second = state();
    if (field === 'policy') second.config.policy_version = '2'; else second.budget.next_nonce = '1';
    mocks.vault.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const result = await send(await create(), command());
    expect(result.ok).toBe(false); expect(result.error).toContain('POLICY_OR_NONCE_CHANGED');
  });
  it('does not expose the runtime if hardware verification fails', async () => {
    mocks.verify.mockRejectedValue(new Error('ATTESTATION_MEASUREMENT'));
    await expect(create()).rejects.toThrow('ATTESTATION_MEASUREMENT'); expect(mocks.vault).not.toHaveBeenCalled();
  });
  it('rejects an incorrect owner secret before any private operation', async () => {
    await expect(send(await create(), command(), 'ff'.repeat(32))).rejects.toThrow('UNAUTHORIZED_PRIVATE_REQUEST');
    expect(mocks.vault).not.toHaveBeenCalled();
  });
  it('restores the journal and replays the exact result without another quote', async () => {
    const request = command(), original = await send(await create(), request);
    expect(original.ok, original.error).toBe(true);
    const restarted = await create(), duplicate = await send(restarted, request);
    expect(duplicate).toEqual(original); expect(mocks.quote).toHaveBeenCalledTimes(1);
    expect((await send(restarted, { ...request, amount: '1000000' })).error).toContain('IDEMPOTENCY_CONFLICT');
  });
  it('serializes competing prepares so only one outstanding nonce is signed', async () => {
    const runtime = await create();
    const replies = await Promise.all([send(runtime, command()), send(runtime, command())]);
    expect(replies.filter(r => r.ok)).toHaveLength(1);
    expect(replies.find(r => !r.ok)?.error).toContain('AUTHORIZATION_PENDING'); expect(mocks.quote).toHaveBeenCalledTimes(1);
  });
  it('does not execute a request that expires while queued behind research', async () => {
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const researching = new Promise<void>(resolve => { entered = resolve; });
    const originalReports = mocks.reports.getMockImplementation()!;
    mocks.reports.mockImplementationOnce(async () => { entered(); await barrier; return originalReports(); });
    const runtime = await create(), first = send(runtime, command());
    await researching;
    // Observe queue insertion only; commands still enter through authenticated HPKE.
    const queue = () => (runtime as unknown as { queue: Promise<unknown> }).queue;
    const previous = queue(), second = send(runtime, command());
    await expect.poll(() => queue() !== previous).toBe(true);
    const later = Date.now() + 120000; vi.spyOn(Date, 'now').mockReturnValue(later);
    release();
    const [active, expired] = await Promise.all([first, second]);
    expect(active.ok, active.error).toBe(true);
    expect(expired.ok).toBe(false); expect(expired.error).toContain('PRIVATE_REQUEST_EXPIRED');
    expect(mocks.quote).toHaveBeenCalledTimes(1);
  });
  it('preserves observation idempotency while a fresh id polls again', async () => {
    const runtime = await create(), prepared = await send(runtime, command());
    expect(prepared.ok, prepared.error).toBe(true);
    const signed = prepared.value.signed;
    mocks.record.mockResolvedValue({ blockHash: 'fixture-final-block', value: { authorization_hash: signed.hash, quote_hash: signed.authorization.quote_hash, status: 'Dispatched' } });
    const poll = { type: 'observe', id: randomUUID(), authorizationHash: signed.hash };
    const pending = await send(runtime, poll);
    expect(pending.value.status).toBe('pending-settlement'); expect(pending.value.transaction).toBeUndefined();
    mocks.status.mockResolvedValue({ outcome: 'success', raw: { status: 'SUCCESS' } });
    expect(await send(runtime, poll)).toEqual(pending);
    const settled = await send(runtime, { ...poll, id: randomUUID() });
    expect(settled.value.status).toBe('observed-success'); expect(settled.value.resubmit).toBe(false);
    const args = settled.value.transaction.actions[0].params.args;
    expect(verifyHash(sha256(settlementBytes(args.settlement)), args.signature, identity.executorPublicKey)).toBe(true);
  });
  it('never returns an authorization when the journal cannot be persisted', async () => {
    const runtime = await create();
    // Make the pending file a directory so the actual atomic writer fails before rename.
    const { mkdir } = await import('node:fs/promises'); await mkdir(join(directory, 'audit.json.pending'));
    const result = await send(runtime, command());
    expect(result.ok).toBe(false); expect(result.value).toBeUndefined();
    expect(mocks.quote).toHaveBeenCalledTimes(1); expect(result.error).toMatch(/EISDIR|illegal operation on a directory/);
    await rm(join(directory, 'audit.json.pending'), { recursive: true });
    expect((await send(runtime, command())).error).toContain('JOURNAL_UNAVAILABLE');
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    await expect(create()).rejects.toThrow('JOURNAL_MANIFEST_MISSING');
  });
});

describe('owner client through the encrypted runtime protocol (external services are fixtures)', () => {
  const researchRequest = () => { const { amount: _amount, kind: _kind, counterparty: _counterparty, ...rest } = command(); return { ...rest, type: 'research' as const }; };
  const config = (): OwnerRuntime => ({ format: 'neslos-owner-runtime-v1', endpoint: 'https://enclave.fixture.invalid', network: 'mainnet', vault: 'vault.near', executorPublicKey: identity.executorPublicKey, teePolicy });
  function transport(runtime: PrivateRuntime) {
    let dropReply = false;
    const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.startsWith('/attestation/')) return Response.json(await identity.attest(path.split('/').at(-1)!));
      expect(path).toBe('/private');
      const body = String(options!.body);
      expect(body).not.toContain(token); expect(body).not.toContain('Compare stablecoin yields');
      const { nonce, envelope } = JSON.parse(body);
      const result = await runtime.handle(nonce, envelope);
      if (dropReply) { dropReply = false; throw new TypeError('fetch failed'); }
      return Response.json(result);
    });
    vi.stubGlobal('fetch', fetcher);
    return { fetcher, loseNextReply: () => { dropReply = true; } };
  }
  it('executes read-only private research on testnet without quotes or authorizations', async () => {
    const runtime = await PrivateRuntime.create({ network: 'testnet', vault: 'vault.testnet', teePolicy, inferencePolicy: { modelId: 'fixture', gateway: { osImageHash: 'aa'.repeat(32), composeHash: 'bb'.repeat(32) }, model: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32) } }, ownerToken: token, nearAiKey: 'fixture', journalPath: join(directory, 'audit.json') });
    const request = researchRequest(), reply = await send(runtime, request);
    expect(reply.ok, reply.error).toBe(true); expect(reply.value.network).toBe('testnet');
    expect(reply.value.transaction).toBeUndefined(); expect(reply.value.signed).toBeUndefined();
    expect(mocks.quote).not.toHaveBeenCalled(); expect(mocks.reports).toHaveBeenCalledTimes(1);
  });
  it('exports and independently verifies the audit and a signed plaintext opening', async () => {
    const runtime = await create(); transport(runtime);
    const job = await runPrivateJob(config(), token, researchRequest(), join(directory, 'owner-job.json'));
    const before = await readFile(join(directory, 'audit.json'), 'utf8');
    const bundle = await downloadPrivateAudit(config(), token);
    expect(bundle.scope).toBe('attested-executor'); expect(bundle.entries).toHaveLength(2);
    const entry = bundle.entries.find(e => e.type === 'research.completed')!;
    const opened = await openPrivateReceipt(config(), token, bundle, entry.id);
    expect(opened.value).toEqual(job.result); expect(opened.opening.entryHash).toBe(entry.hash);
    expect(await readFile(join(directory, 'audit.json'), 'utf8')).toBe(before);
    expect(before).not.toContain('Compare stablecoin yields');
    await expect(downloadPrivateAudit(config(), token, 'ff'.repeat(32))).rejects.toThrow('AUDIT_VERIFICATION');
  });
  it('downloads an audit larger than one encrypted response without journaling the export', async () => {
    mocks.research.mockResolvedValue({ ...evidence(), notices: ['x'.repeat(120_000)] });
    const runtime = await create(); transport(runtime);
    await runPrivateJob(config(), token, researchRequest(), join(directory, 'job.json'));
    const bundle = await downloadPrivateAudit(config(), token);
    expect(Buffer.byteLength(canonical(bundle))).toBeGreaterThan(128_000);
    expect(bundle.entries).toHaveLength(2); expect(verifyAudit(bundle, identity.executorPublicKey).valid).toBe(true);
  });
  it('pins the export checkpoint even when the journal grows between pages', async () => {
    mocks.research.mockResolvedValue({ ...evidence(), notices: ['x'.repeat(120_000)] });
    const runtime = await create(); await send(runtime, researchRequest());
    const first = (await send(runtime, { type: 'audit-export', id: randomUUID(), offset: 0 })).value;
    await send(runtime, researchRequest());
    const chunks = [Buffer.from(first.chunk, 'base64')]; let offset = first.nextOffset;
    while (offset !== null) {
      const page = (await send(runtime, { type: 'audit-export', id: randomUUID(), offset, checkpoint: first.checkpoint })).value;
      chunks.push(Buffer.from(page.chunk, 'base64')); offset = page.nextOffset;
    }
    const bundle = JSON.parse(Buffer.concat(chunks).toString());
    expect(bundle.entries).toHaveLength(2); expect(bundle.checkpoint).toBe(first.checkpoint);
    expect(verifyAudit(bundle, identity.executorPublicKey).valid).toBe(true);
  });
  it('recovers a lost reply with the saved command id without repeating inference', async () => {
    const runtime = await create(), wire = transport(runtime), input = researchRequest();
    const { id: _id, ...withoutId } = input, path = join(directory, 'job.json');
    wire.loseNextReply();
    await expect(runPrivateJob(config(), token, withoutId, path)).rejects.toThrow();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const recovered = await runPrivateJob(config(), token, withoutId, path);
    expect(recovered.command.id).toBe(saved.command.id); expect(recovered.state).toBe('complete');
    expect(mocks.reports).toHaveBeenCalledTimes(1);
    await expect(runPrivateJob(config(), token, { ...withoutId, prompt: 'A changed request' }, path)).rejects.toThrow('PRIVATE_JOB_CONFLICT');
  });
  it('refuses a different attested executor before transmitting the owner secret', async () => {
    const runtime = await create(), wire = transport(runtime);
    await expect(privateCommand(config().endpoint, teePolicy, token, researchRequest(), 'ff'.repeat(32))).rejects.toThrow('ATTESTED_EXECUTOR_CHANGED');
    expect(wire.fetcher).toHaveBeenCalledTimes(1); expect(mocks.reports).not.toHaveBeenCalled();
  });
  it('rejects hardware verification failure before sending any encrypted command', async () => {
    const runtime = await create(), wire = transport(runtime); mocks.verify.mockRejectedValue(new Error('ATTESTATION_MEASUREMENT'));
    await expect(privateCommand(config().endpoint, teePolicy, token, researchRequest())).rejects.toThrow('ATTESTATION_MEASUREMENT');
    expect(wire.fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses an opening for a different receipt hash', async () => {
    const runtime = await create(); await send(runtime, researchRequest());
    const bundle = (await new AuditJournal(join(directory, 'audit.json'), identity.executorPublicKey).load())!;
    expect((await send(runtime, { type: 'audit-open', id: randomUUID(), entryId: bundle.entries[0]!.id, entryHash: 'ff'.repeat(32) })).error).toContain('AUDIT_ENTRY_BINDING');
  });
});
