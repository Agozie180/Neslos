import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditLog } from '../core/audit.js';
import { createTeeIdentity, freshChallenge, teePolicySchema, verifyTeeEvidence, type TeeIdentity, type TeePolicy } from '../core/attestation.js';
import { decryptChannel, encryptChannel, type Envelope } from '../core/channel.js';
import { canonical, commitment, sha256, signHash } from '../core/crypto.js';
import { inferencePolicySchema, PrivateResearchers, type InferencePolicy } from '../core/inference.js';
import { checkInferenceBudget, DISABLED_INFERENCE_BUDGET, inferenceReservationSchema, inferenceUsage, type InferenceBudgetPolicy, type InferenceReservation } from '../core/inference-budget.js';
import { selectStrategy } from '../core/strategy.js';
import { IntentsClient, type ValidatedQuote } from '../core/intents.js';
import { readVault, viewNear } from '../core/near.js';
import { checkPolicy, DEFAULT_POLICY } from '../core/policy.js';
import { NATIVE_USDC, rankMarkets, ResearchService } from '../core/research.js';
import { authorizationSchema, hashHex, nearAccount, signAuthorization, settlementBytes, type Authorization, type SettlementWire } from '../core/wire.js';
import { units } from '../core/amounts.js';
import type { BudgetSnapshot, Policy, Proposal } from '../core/types.js';
import { AuditJournal, JOURNAL_COMMAND_LIMIT, JOURNAL_LIMIT_BYTES } from './journal.js';
import { commandSchema, type PrivateCommand, type prepareSchema, type researchCommandSchema, type auditExportSchema, type auditOpenSchema } from '../core/private-protocol.js';
export { commandSchema, prepareSchema } from '../core/private-protocol.js';

const requestSchema = z.object({ ownerToken: hashHex, expiresAt: z.number().int(), replyKey: hashHex, command: commandSchema }).strict();
type Command = PrivateCommand;
type Prepared = { authorization: Authorization; signature: string; hash: string };
interface Options { network: 'mainnet' | 'testnet'; vault: string; teePolicy: TeePolicy; inferenceEnabled?: boolean; inferencePolicy?: InferencePolicy; ownerToken: string; nearAiKey?: string; journalPath: string; socket?: string }

/** All private research, openings, quote inspection, signing and journal decryption happen here. */
export class PrivateRuntime {
  private audit: AuditLog;
  private research = new ResearchService();
  private researchers?: PrivateResearchers;
  private readonly inferenceBudget: InferenceBudgetPolicy;
  private intents = new IntentsClient();
  private journal: AuditJournal;
  private queue: Promise<unknown> = Promise.resolve();
  private journalUnavailable = false;
  private inferenceReservations: InferenceReservation[] = [];
  private attempted = new Map<string, string>();
  private executing?: { id: string; fingerprint: string };
  private completed = new Map<string, { fingerprint: string; result: unknown }>();
  private failed = new Map<string, { fingerprint: string; reason: string }>();
  private prepared = new Map<string, { signed: Prepared; quote: ValidatedQuote }>();
  get ready() { return !this.journalUnavailable; }
  get inferenceEnabled() { return this.researchers !== undefined; }
  private constructor(private options: Options, readonly identity: TeeIdentity) {
    this.audit = new AuditLog('attested', { signingSeed: identity.signingSeed, encryptionKey: identity.auditKey });
    this.inferenceBudget = options.inferenceEnabled === false ? { ...DISABLED_INFERENCE_BUDGET } : inferencePolicySchema.parse(options.inferencePolicy).budget;
    if (options.inferenceEnabled !== false) this.researchers = new PrivateResearchers(options.inferencePolicy!, options.nearAiKey!, async reservation => {
      if (this.journalUnavailable) throw new Error('JOURNAL_UNAVAILABLE');
      if (!this.executing) throw new Error('INFERENCE_COMMAND_REQUIRED');
      checkInferenceBudget(this.inferenceReservations, reservation, this.inferenceBudget);
      this.audit.append('inference.reserved', this.executing.id, { fingerprint: this.executing.fingerprint, reservation });
      await this.persist();
      this.inferenceReservations.push(reservation);
      this.attempted.set(this.executing.id, this.executing.fingerprint);
    });
    this.journal = new AuditJournal(options.journalPath, identity.executorPublicKey);
  }
  static async create(options: Options): Promise<PrivateRuntime> {
    nearAccount.parse(options.vault); hashHex.parse(options.ownerToken);
    // Keep attestation pins and credit authority on one validated startup snapshot.
    // A caller retaining the input object must not change them after verification.
    const inferenceEnabled = options.inferenceEnabled !== false;
    if (!inferenceEnabled && (options.inferencePolicy || options.nearAiKey)) throw new Error('INFERENCE_DISABLED_CONFIGURATION');
    if (inferenceEnabled && !options.nearAiKey) throw new Error('NEARAI_API_KEY is required.');
    options = { ...options, inferenceEnabled, teePolicy: teePolicySchema.parse(options.teePolicy), inferencePolicy: inferenceEnabled ? inferencePolicySchema.parse(options.inferencePolicy) : undefined };
    const identity = await createTeeIdentity(options.socket);
    const challenge = freshChallenge();
    await verifyTeeEvidence(await identity.attest(challenge), options.teePolicy, challenge);
    const runtime = new PrivateRuntime(options, identity);
    await runtime.loadJournal();
    return runtime;
  }
  private async loadJournal() {
      const bundle = await this.journal.load();
      if (!bundle) return;
      this.audit.restore(bundle);
      for (const entry of bundle.entries) {
        if (entry.type === 'inference.reserved') {
          const record = z.object({ fingerprint: hashHex, reservation: inferenceReservationSchema }).strict().parse(this.audit.open(entry.id));
          this.inferenceReservations.push(record.reservation);
          this.attempted.set(entry.runId, record.fingerprint);
        }
        if (entry.type === 'command.failed') this.failed.set(entry.runId, z.object({ fingerprint: hashHex, reason: z.string() }).parse(this.audit.open(entry.id)));
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
  }
  private async persist() {
    try {
      await this.journal.save(this.audit.export());
    } catch (error) {
      // Memory and durable state may disagree after I/O failure. Recover from disk,
      // never continue issuing authorizations from this process's tentative state.
      this.journalUnavailable = true;
      throw error;
    }
  }
  async handle(nonce: string, envelope: Envelope) {
    hashHex.parse(nonce);
    const privateRequest = requestSchema.parse(await decryptChannel(this.identity.channelKeys, envelope, { domain: 'neslos:request:v1', nonce }));
    const now = Date.now();
    if (privateRequest.expiresAt <= now || privateRequest.expiresAt > now + 120_000 || !timingSafeEqual(Buffer.from(privateRequest.ownerToken, 'hex'), Buffer.from(this.options.ownerToken, 'hex'))) throw new Error('UNAUTHORIZED_PRIVATE_REQUEST');
    const work = this.queue.then(() => {
      if (privateRequest.expiresAt <= Date.now()) throw new Error('PRIVATE_REQUEST_EXPIRED: request expired while queued.');
      return this.execute(privateRequest.command);
    });
    this.queue = work.then(() => undefined, () => undefined);
    // Errors after owner authentication are encrypted to the owner's reply key, too.
    const result = await work.then(value => ({ ok: true, value }), error => ({ ok: false, error: error instanceof Error ? error.message : 'Private operation failed.' }));
    const response = await encryptChannel(privateRequest.replyKey, result, { domain: 'neslos:response:v1', nonce });
    return { nonce, envelope: response, signature: signHash(sha256(canonical({ nonce, envelope: response })), this.identity.signingKey) };
  }
  private async execute(command: Command): Promise<unknown> {
    if (command.type === 'status') return { ready: this.ready, inference: { enabled: this.inferenceEnabled, ...inferenceUsage(this.inferenceReservations), limits: this.inferenceBudget }, completedCommands: this.completed.size, commandLimit: JOURNAL_COMMAND_LIMIT, journalLimitBytes: JOURNAL_LIMIT_BYTES };
    // Read-only export must remain available at the completed-command quota.
    // These responses are not appended to the journal they export (no recursive growth).
    if (command.type === 'audit-export') return this.exportAudit(command);
    if (command.type === 'audit-open') return this.openAudit(command);
    if (!this.researchers && (command.type === 'research' || command.type === 'prepare')) throw new Error('PRIVATE_RESEARCH_DISABLED: this deployment enables owner status, observation and audit commands only.');
    if (this.journalUnavailable) throw new Error('JOURNAL_UNAVAILABLE: restore durable storage and restart before another private command.');
    const fingerprint = sha256(canonical(command));
    const previous = this.completed.get(command.id);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT'); return previous.result; }
    const failed = this.failed.get(command.id);
    if (failed) { if (failed.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT'); throw new Error(failed.reason); }
    const attempted = this.attempted.get(command.id);
    if (attempted) {
      if (attempted !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
      throw new Error('INFERENCE_OUTCOME_UNKNOWN: this job reserved credit before interruption. Inspect its audit; it will not pay again.');
    }
    if (this.completed.size + this.failed.size >= JOURNAL_COMMAND_LIMIT) throw new Error('INSTANCE_CAPACITY: retain the complete archive and its checkpoints before planning a new runtime.');
    let result: unknown;
    const reservationsBefore = this.inferenceReservations.length;
    this.executing = { id: command.id, fingerprint };
    try {
      result = command.type === 'prepare' ? await this.prepare(command) : command.type === 'research' ? await this.discover(command) : await this.observe(command.authorizationHash, command.id);
      this.audit.append('command.completed', command.id, { fingerprint, result });
      await this.persist(); // Never release an authorization before its encrypted evidence is durable.
      this.completed.set(command.id, { fingerprint, result });
      return result;
    }
    catch (error) {
      if (this.journalUnavailable) throw error;
      const denial = { fingerprint, reason: error instanceof Error ? error.message : 'Private operation failed.' };
      const spentCredit = this.inferenceReservations.length > reservationsBefore;
      this.audit.append(spentCredit ? 'command.failed' : 'command.denied', command.id, denial);
      if (spentCredit) this.failed.set(command.id, denial);
      await this.persist(); throw error;
    } finally { this.executing = undefined; }
  }
  private exportAudit(command: z.infer<typeof auditExportSchema>) {
    // Never export tentative in-memory state following a failed write.
    if (this.journalUnavailable) throw new Error('JOURNAL_UNAVAILABLE: restart from durable storage before exporting.');
    if (command.offset > 0 && !command.checkpoint) throw new Error('AUDIT_CHECKPOINT_REQUIRED');
    const bundle = this.audit.export(command.checkpoint), bytes = Buffer.from(canonical(bundle));
    if (command.offset > bytes.length) throw new Error('AUDIT_OFFSET');
    const end = Math.min(bytes.length, command.offset + 128_000);
    return { checkpoint: bundle.checkpoint, offset: command.offset, totalBytes: bytes.length, chunk: bytes.subarray(command.offset, end).toString('base64'), nextOffset: end < bytes.length ? end : null };
  }
  private openAudit(command: z.infer<typeof auditOpenSchema>) {
    if (this.journalUnavailable) throw new Error('JOURNAL_UNAVAILABLE: restart from durable storage before opening.');
    const entry = this.audit.export().entries.find(e => e.id === command.entryId);
    if (!entry || entry.hash !== command.entryHash) throw new Error('AUDIT_ENTRY_BINDING');
    const value = this.audit.open(entry.id);
    const opening = { domain: 'neslos:audit-opening:v1', entryHash: entry.hash, valueHash: sha256(canonical(value)) };
    return { value, opening, signature: signHash(sha256(canonical(opening)), this.identity.signingKey) };
  }
  private async discover(command: z.infer<typeof researchCommandSchema>) {
    const state = await readVault(this.options.vault, this.options.network);
    if (state.config.executor_public_key !== this.identity.executorPublicKey) throw new Error('EXECUTOR_NOT_PINNED');
    const version = Number(state.config.policy_version);
    if (!Number.isSafeInteger(version)) throw new Error('UNSUPPORTED_POLICY_VERSION');
    const chain = state.config.policy;
    const policy: Policy = { ...DEFAULT_POLICY, ...command.research, id: this.options.vault, version,
      dailyLimit: chain.daily_limit, perTransactionLimit: chain.per_action_limit, maxSlippageBps: chain.max_slippage_bps,
      maxQuoteAgeSeconds: Number(chain.max_quote_age_ms) / 1000, paused: chain.paused, requireConfidential: chain.require_confidential,
      allowedVenues: command.venues.filter(v => chain.venue_commitments.includes(commitment('venue', v.name, v.salt))).map(v => v.name), allowedCounterparties: [],
    };
    const research = await this.research.discover({ refresh: true });
    if (research.sourceMode !== 'live') throw new Error('LIVE_RESEARCH_REQUIRED');
    const reports = await this.researchers!.research(research, policy, command.prompt, chain.output_assets);
    const ranking = rankMarkets(research.markets, policy, chain.output_assets), strategy = selectStrategy(ranking, reports);
    const result = { research, reports, ranking, strategy, chainBlock: state.blockHash,
      network: this.options.network, policyVersion: state.config.policy_version,
      disclosure: 'Private research only. No quote, authorization, transaction or lending position. Market data describes mainnet opportunities even when the policy vault is on testnet.' };
    this.audit.append('research.completed', command.id, result);
    return result;
  }
  private async prepare(command: z.infer<typeof prepareSchema>) {
    if (this.options.network !== 'mainnet') throw new Error('INTENTS_NETWORK: 1Click has no testnet. Use the local sandbox for unfunded contract verification.');
    this.intents.assertConfidentialQuoteConfigured();
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
    const ranked = rankMarkets(research.markets, policy, state.config.policy.output_assets);
    if (command.kind === 'allocation-reserve' && !ranked.some(m => m.eligible)) throw new Error('NO_ELIGIBLE_MARKET');
    if (command.kind === 'private-payment' && !state.config.policy.output_assets.includes('nep141:usdt.tether-token.near')) throw new Error('OUTPUT_ASSET: the vault policy excludes the destination token.');
    const reports = await this.researchers!.research(research, policy, command.prompt, state.config.policy.output_assets);
    const strategyDecision = selectStrategy(ranked, reports);
    const best = ranked.find(m => m.id === strategyDecision.selectedMarketId);
    if (command.kind === 'allocation-reserve' && !best) throw new Error('RESEARCH_REFUSED: no eligible market received all three researchers\' approval.');
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
    const auditEntry = this.audit.append('guardian.approved', command.id, { proposal, decision, reports, research, strategy: strategyDecision, quote, chainBlock: current.blockHash });
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
    return { signed, reports, decision, strategy: strategyDecision, chainBlock: current.blockHash, transaction: {
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
