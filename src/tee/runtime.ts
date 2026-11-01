import { timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { AuditLog } from '../core/audit.js';
import { createTeeIdentity, freshChallenge, verifyTeeEvidence, type TeeIdentity, type TeePolicy } from '../core/attestation.js';
import { decryptChannel, encryptChannel, type Envelope } from '../core/channel.js';
import { canonical, commitment, sha256, signHash } from '../core/crypto.js';
import { PrivateResearchers, type InferencePolicy } from '../core/inference.js';
import { IntentsClient, type ValidatedQuote } from '../core/intents.js';
import { readVault, viewNear } from '../core/near.js';
import { checkPolicy, DEFAULT_POLICY } from '../core/policy.js';
import { NATIVE_USDC, rankMarkets, ResearchService } from '../core/research.js';
import { authorizationSchema, hashHex, nearAccount, signAuthorization, settlementBytes, type Authorization, type SettlementWire } from '../core/wire.js';
import { units } from '../core/amounts.js';
import type { AuditExport, BudgetSnapshot, Policy, Proposal } from '../core/types.js';

const amount = z.string().max(39).refine(v => { try { return units(v) > 0n; } catch { return false; } });
const opening = z.object({ name: z.enum(['near-intents', 'rhea-lending', 'rhea-dex', 'meta-pool', 'linear']), salt: hashHex }).strict();
export const prepareSchema = z.object({
  type: z.literal('prepare'), id: z.string().uuid(), prompt: z.string().min(5).max(1600),
  amount, kind: z.enum(['private-payment', 'allocation-reserve']),
  counterparty: z.object({ recipient: nearAccount, salt: hashHex }).strict(),
  venues: z.array(opening).min(1).max(16),
  research: z.object({ stablecoinsOnly: z.boolean(), allowBridgedAssets: z.boolean(), minimumLiquidityUsd: z.number().finite().min(0).max(1e12) }).strict(),
}).strict();
const observeSchema = z.object({ type: z.literal('observe'), id: z.string().uuid(), authorizationHash: hashHex }).strict();
export const commandSchema = z.discriminatedUnion('type', [prepareSchema, observeSchema]);
const requestSchema = z.object({ ownerToken: hashHex, expiresAt: z.number().int(), replyKey: hashHex, command: commandSchema }).strict();
type Command = z.infer<typeof commandSchema>;
type Prepared = { authorization: Authorization; signature: string; hash: string };
interface Options { network: 'mainnet' | 'testnet'; vault: string; teePolicy: TeePolicy; inferencePolicy: InferencePolicy; ownerToken: string; nearAiKey: string; journalPath: string; socket?: string }

/** All private research, openings, quote inspection, signing and journal decryption happen here. */
export class PrivateRuntime {
  private audit: AuditLog;
  private research = new ResearchService();
  private researchers: PrivateResearchers;
  private intents = new IntentsClient();
  private journal: string;
  private queue: Promise<unknown> = Promise.resolve();
  private completed = new Map<string, { fingerprint: string; result: unknown }>();
  private prepared = new Map<string, { signed: Prepared; quote: ValidatedQuote }>();
  private constructor(private options: Options, readonly identity: TeeIdentity) {
    this.audit = new AuditLog('attested', { signingSeed: identity.signingSeed, encryptionKey: identity.auditKey });
    this.researchers = new PrivateResearchers(options.inferencePolicy, options.nearAiKey);
    this.journal = resolve(options.journalPath);
  }
  static async create(options: Options): Promise<PrivateRuntime> {
    nearAccount.parse(options.vault); hashHex.parse(options.ownerToken);
    const identity = await createTeeIdentity(options.socket);
    const challenge = freshChallenge();
    await verifyTeeEvidence(await identity.attest(challenge), options.teePolicy, challenge);
    const runtime = new PrivateRuntime(options, identity);
    await runtime.loadJournal();
    return runtime;
  }
  private async loadJournal() {
    try {
      if ((await stat(this.journal)).size > 32_000_000) throw new Error('Journal reached its size bound. Archive with a retained on-chain checkpoint before rotating.');
      const bundle = JSON.parse(await readFile(this.journal, 'utf8')) as AuditExport;
      this.audit.restore(bundle);
      for (const entry of bundle.entries) {
        if (entry.type === 'authorization.prepared') {
          const record = this.audit.open(entry.id) as { signed: Prepared; quote: ValidatedQuote };
          authorizationSchema.parse(record.signed.authorization);
          this.prepared.set(record.signed.hash, record);
        }
        if (entry.type === 'command.completed') {
          const record = this.audit.open(entry.id) as { fingerprint: string; result: unknown };
          this.completed.set(entry.runId, record);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  private async persist() {
    await mkdir(dirname(this.journal), { recursive: true, mode: 0o700 });
    const data = canonical(this.audit.export());
    if (Buffer.byteLength(data) > 32_000_000) throw new Error('JOURNAL_CAPACITY: encrypted audit archive required.');
    const temporary = this.journal + '.pending';
    const file = await open(temporary, 'w', 0o600);
    try { await file.writeFile(data, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, this.journal);
  }
  async handle(nonce: string, envelope: Envelope) {
    hashHex.parse(nonce);
    const privateRequest = requestSchema.parse(await decryptChannel(this.identity.channelKeys, envelope, { domain: 'neslos:request:v1', nonce }));
    const now = Date.now();
    if (privateRequest.expiresAt <= now || privateRequest.expiresAt > now + 120_000 || !timingSafeEqual(Buffer.from(privateRequest.ownerToken, 'hex'), Buffer.from(this.options.ownerToken, 'hex'))) throw new Error('UNAUTHORIZED_PRIVATE_REQUEST');
    const work = this.queue.then(() => this.execute(privateRequest.command));
    this.queue = work.then(() => undefined, () => undefined);
    // Errors after owner authentication are encrypted to the owner's reply key, too.
    const result = await work.then(value => ({ ok: true, value }), error => ({ ok: false, error: error instanceof Error ? error.message : 'Private operation failed.' }));
    const response = await encryptChannel(privateRequest.replyKey, result, { domain: 'neslos:response:v1', nonce });
    return { nonce, envelope: response, signature: signHash(sha256(canonical({ nonce, envelope: response })), this.identity.signingKey) };
  }
  private async execute(command: Command): Promise<unknown> {
    const fingerprint = sha256(canonical(command));
    const previous = this.completed.get(command.id);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT'); return previous.result; }
    if (this.completed.size >= 1000) throw new Error('INSTANCE_CAPACITY: archive and rotate with retained checkpoints.');
    let result: unknown;
    try { result = command.type === 'prepare' ? await this.prepare(command) : await this.observe(command.authorizationHash, command.id); }
    catch (error) {
      this.audit.append('command.denied', command.id, { fingerprint, reason: error instanceof Error ? error.message : 'Private operation failed.' });
      await this.persist(); throw error;
    }
    this.audit.append('command.completed', command.id, { fingerprint, result });
    await this.persist(); // Never release an authorization before its encrypted evidence is durable.
    this.completed.set(command.id, { fingerprint, result });
    return result;
  }
  private async prepare(command: z.infer<typeof prepareSchema>) {
    if (this.options.network !== 'mainnet') throw new Error('INTENTS_NETWORK: 1Click has no testnet. Use the local sandbox for unfunded contract verification.');
    const state = await readVault(this.options.vault, this.options.network);
    if (state.config.executor_public_key !== this.identity.executorPublicKey) throw new Error('EXECUTOR_NOT_PINNED: the owner has not approved this attested key on chain.');
    if (state.config.token_id !== NATIVE_USDC) throw new Error('INPUT_ASSET: this adapter only spends native NEAR USDC.');
    const version = Number(state.config.policy_version);
    if (!Number.isSafeInteger(version)) throw new Error('UNSUPPORTED_POLICY_VERSION');
    const allowedVenues = command.venues.filter(v => state.config.policy.venue_commitments.includes(commitment('venue', v.name, v.salt)));
    const venue = allowedVenues.find(v => v.name === 'near-intents');
    if (!venue) throw new Error('VENUE: confidential Intents is not allowed by this vault.');
    const counterpartyCommitment = commitment('counterparty', command.counterparty.recipient, command.counterparty.salt);
    if (!state.config.policy.counterparty_commitments.includes(counterpartyCommitment)) throw new Error('COUNTERPARTY: the private recipient does not open an allowed commitment.');
    const policy: Policy = { ...DEFAULT_POLICY, ...command.research, id: this.options.vault, version, dailyLimit: state.config.policy.daily_limit, perTransactionLimit: state.config.policy.per_action_limit, maxSlippageBps: state.config.policy.max_slippage_bps, maxQuoteAgeSeconds: Number(state.config.policy.max_quote_age_ms) / 1000, allowedVenues: allowedVenues.map(v => v.name), allowedCounterparties: [command.counterparty.recipient], paused: state.config.policy.paused, requireConfidential: state.config.policy.require_confidential };
    if (policy.paused || units(command.amount) > units(state.budget.remaining) || units(command.amount) > units(policy.perTransactionLimit) || units(command.amount) > units(state.balance)) throw new Error('SPENDING_BOUNDARY: paused, insufficient allowance, per-action cap, or insufficient funds.');
    for (const pending of this.prepared.values()) if (pending.signed.authorization.nonce === state.budget.next_nonce && Number(pending.signed.authorization.expires_at_ms) > Date.now()) throw new Error('AUTHORIZATION_PENDING: observe or let the current authorization expire; never retry funds blindly.');
    const research = await this.research.discover({ refresh: true });
    if (research.sourceMode !== 'live') throw new Error('LIVE_RESEARCH_REQUIRED');
    const reports = await this.researchers.research(research, policy, command.prompt);
    const ranked = rankMarkets(research.markets, policy);
    const best = ranked.find(m => m.eligible);
    if (command.kind === 'allocation-reserve' && !best) throw new Error('NO_ELIGIBLE_MARKET');
    const outputAsset = command.kind === 'allocation-reserve' ? 'nep141:' + best!.tokenId : 'nep141:usdt.tether-token.near';
    if (!state.config.policy.output_assets.includes(outputAsset)) throw new Error('OUTPUT_ASSET: the vault policy excludes the destination token.');
    const quote = await this.intents.quote({ amount: command.amount, maxSlippageBps: policy.maxSlippageBps, recipient: command.counterparty.recipient, refundTo: this.options.vault, dry: false, destinationAsset: outputAsset });
    const current = await readVault(this.options.vault, this.options.network);
    if (current.config.policy_version !== state.config.policy_version || current.budget.next_nonce !== state.budget.next_nonce) throw new Error('POLICY_OR_NONCE_CHANGED: create a new proposal against the latest chain state.');
    const q = quote.response.quote;
    const quotedAt = Date.parse(quote.response.timestamp);
    const expiresAt = Math.min(Date.parse(q.deadline!), quotedAt + policy.maxQuoteAgeSeconds * 1000, quotedAt + 60_000);
    const proposal: Proposal = { id: command.id, policyId: policy.id, policyVersion: policy.version, nonce: current.budget.next_nonce, kind: command.kind, amount: command.amount, asset: 'USDC', venue: 'near-intents', ...(command.kind === 'allocation-reserve' ? { strategyVenue: best!.venue, opportunityId: best!.id } : {}), counterparty: command.counterparty.recipient, privacy: 'confidential', slippageBps: policy.maxSlippageBps, quotedOutput: q.amountOut, minimumOutput: q.minAmountOut, quotedAt, expiresAt, purpose: command.kind === 'private-payment' ? 'Private research payment.' : 'Allocation reserve for ' + best!.protocol + ' ' + best!.symbol + '. No lending deposit.', mode: 'attested' };
    const budget: BudgetSnapshot = { day: new Date(Number(current.budget.day) * 86_400_000).toISOString().slice(0, 10), spent: current.budget.used, remaining: current.budget.remaining, balance: current.balance, nextNonce: current.budget.next_nonce, reserved: '0', reservations: 0 };
    const decision = checkPolicy(policy, proposal, budget);
    if (!decision.allowed) throw new Error('GUARDIAN: ' + decision.checks.filter(c => !c.passed).map(c => c.code).join(', '));
    const auditEntry = this.audit.append('guardian.approved', command.id, { proposal, decision, reports, research, quote, chainBlock: current.blockHash });
    const strategy = command.kind === 'allocation-reserve' ? allowedVenues.find(v => v.name === best!.venue) : undefined;
    const authorization: Authorization = {
      domain: 'neslos:authorize:v1', network: this.options.network, vault: this.options.vault, policy_version: current.config.policy_version, nonce: current.budget.next_nonce,
      amount: command.amount, quoted_output: q.amountOut, minimum_output: q.minAmountOut, slippage_bps: policy.maxSlippageBps,
      quoted_at_ms: String(quotedAt), expires_at_ms: String(expiresAt), venue_commitment: commitment('venue', venue.name, venue.salt),
      strategy_venue_commitment: strategy ? commitment('venue', strategy.name, strategy.salt) : null,
      counterparty_commitment: counterpartyCommitment, deposit_account: q.depositAddress!, output_asset: outputAsset,
      quote_hash: quote.hash, confidential: true, action: command.kind === 'private-payment' ? 0 : 1, audit_hash: auditEntry.hash,
    };
    const signed = signAuthorization(authorization, this.identity.signingKey);
    this.audit.append('authorization.prepared', command.id, { signed, quote });
    this.prepared.set(signed.hash, { signed, quote });
    return { signed, reports, decision, chainBlock: current.blockHash, transaction: {
      receiverId: this.options.vault, actions: [{ type: 'FunctionCall', params: { methodName: 'authorize', args: { authorization, signature: signed.signature }, gas: '100000000000000', deposit: '10000000000000000000000' } }],
    }, disclosure: 'Prepared for owner review or an authorized relayer. Not submitted or settled. USDC allowance is reserved only by the on-chain call. NEAR gas and storage are separate.' };
  }
  private async observe(authorizationHash: string, id: string) {
    const prepared = this.prepared.get(authorizationHash);
    if (!prepared) throw new Error('UNKNOWN_AUTHORIZATION: retain the encrypted journal for settlement recovery.');
    const a = prepared.signed.authorization;
    const view = await viewNear(this.options.vault, 'get_record', { nonce: a.nonce }, this.options.network);
    const record = z.object({ authorization_hash: hashHex, quote_hash: hashHex, status: z.enum(['Pending', 'Dispatched', 'DispatchFailed', 'Unknown', 'Settled', 'Refunded']) }).passthrough().parse(view.value);
    if (record.authorization_hash !== authorizationHash || record.quote_hash !== a.quote_hash) throw new Error('RECORD_BINDING: another authorization consumed this nonce.');
    if (record.status === 'Pending') return { status: 'pending-dispatch', resubmit: false };
    if (['DispatchFailed', 'Settled', 'Refunded'].includes(record.status)) return { status: record.status, resubmit: false, chainBlock: view.blockHash };
    const observation = await this.intents.status(prepared.quote);
    if (observation.outcome === 'pending') return { status: 'pending-settlement', resubmit: false };
    const outcome: 0 | 1 | 2 = observation.outcome === 'success' ? 1 : observation.outcome === 'refunded' ? 2 : 0;
    const entry = this.audit.append('settlement.observed', id, { authorizationHash, observation, chainBlock: view.blockHash, disclosure: 'Provider status over authenticated HTTPS; the TEE signs this observation, not an independent destination-chain proof.' });
    if (record.status === 'Unknown' && outcome === 0) return { status: 'unknown', resubmit: false, receipt: entry };
    const settlement: SettlementWire = { domain: 'neslos:settlement:v1', network: this.options.network, vault: this.options.vault, nonce: a.nonce, quote_hash: a.quote_hash, outcome, audit_hash: entry.hash };
    const signature = signHash(sha256(settlementBytes(settlement)), this.identity.signingKey);
    return { status: outcome === 1 ? 'observed-success' : outcome === 2 ? 'observed-refund' : 'unknown', resubmit: false, receipt: entry, transaction: { receiverId: this.options.vault, actions: [{ type: 'FunctionCall', params: { methodName: 'record_settlement', args: { settlement, signature }, gas: '30000000000000', deposit: '0' } }] } };
  }
}
