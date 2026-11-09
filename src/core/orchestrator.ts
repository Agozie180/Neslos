import { randomUUID } from 'node:crypto';
import { AuditLog } from './audit.js';
import { minimumOutput, units } from './amounts.js';
import { canonical, sha256 } from './crypto.js';
import { PolicyLedger } from './ledger.js';
import { rankMarkets, researchAgents, ResearchService } from './research.js';
import { selectStrategy } from './strategy.js';
import type { MissionRequest, MissionRun, Proposal, RunStatus } from './types.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const stepDefinitions = [['policy', 'Policy set'], ['research', 'Discover & research'], ['propose', 'Agent proposal'], ['guard', 'Guardian check'], ['execute', 'Private execution'], ['settle', 'Settlement & audit']];

export class Orchestrator {
  private runs = new Map<string, MissionRun>();
  private requests = new Map<string, { fingerprint: string; runId: string }>();
  constructor(readonly ledger: PolicyLedger, readonly audit: AuditLog, private research: ResearchService, private pace = 300, private backgroundTask?: (work: Promise<void>) => void) {}
  list(): MissionRun[] { return [...this.runs.values()].reverse().map(r => structuredClone(r)); }
  get(id: string): MissionRun | undefined { const r = this.runs.get(id); return r ? structuredClone(r) : undefined; }
  start(request: MissionRequest): MissionRun {
    const fingerprint = sha256(canonical(request));
    const existing = this.requests.get(request.requestId);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT: the mission changed.'); return this.get(existing.runId)!; }
    if (this.runs.size >= 100) throw new Error('The rehearsal session has reached its 100-mission limit.');
    if ([...this.runs.values()].filter(r => ['researching', 'proposed', 'checking', 'executing', 'settling'].includes(r.status)).length >= 5) throw new Error('Wait for an active mission to finish.');
    const now = new Date().toISOString();
    const run: MissionRun = { id: randomUUID(), requestId: request.requestId, prompt: request.prompt, kind: request.kind, status: 'researching', mode: 'rehearsal', createdAt: now, updatedAt: now, reports: [], steps: stepDefinitions.map(([id, label], i) => ({ id: id!, label: label!, status: i === 0 ? 'complete' : i === 1 ? 'active' : 'waiting', detail: i === 0 ? `Policy v${this.ledger.policy.version} loaded.` : i === 1 ? 'Researchers are retrieving market evidence.' : '' })) };
    this.runs.set(run.id, run); this.requests.set(request.requestId, { fingerprint, runId: run.id });
    this.audit.append('mission.started', run.id, { request, policyVersion: this.ledger.policy.version });
    const work = this.execute(run, request).catch(error => { run.status = 'failed'; run.error = error instanceof Error ? error.message : 'Mission failed.'; run.updatedAt = new Date().toISOString(); const active = run.steps.find(s => s.status === 'active'); if (active) { active.status = 'failed'; active.detail = run.error; } this.audit.append('mission.failed', run.id, { error: run.error }); });
    // Serverless hosts must keep the invocation alive after the 202 response.
    this.backgroundTask?.(work);
    return structuredClone(run);
  }
  private transition(run: MissionRun, status: RunStatus, activeIndex: number, detail: string): void {
    run.status = status; run.updatedAt = new Date().toISOString();
    run.steps.forEach((step, i) => { if (i < activeIndex) step.status = 'complete'; if (i === activeIndex) { step.status = 'active'; step.detail = detail; step.timestamp = run.updatedAt; } });
  }
  private async execute(run: MissionRun, request: MissionRequest): Promise<void> {
    const research = await this.research.discover({ referenceOnly: request.referenceOnly });
    run.research = research;
    run.reports = await researchAgents(research, this.ledger.policy);
    run.ranking = rankMarkets(research.markets, this.ledger.policy);
    run.strategy = selectStrategy(run.ranking, run.reports);
    run.steps[1]!.detail = `${research.markets.length} markets examined by three independent researchers.`;
    this.audit.append('research.completed', run.id, { reports: run.reports, sourceMode: research.sourceMode, sourceUrl: research.sourceUrl, fetchedAt: research.fetchedAt });
    await delay(this.pace);
    const policy = this.ledger.policy;
    const best = run.ranking.find(m => m.id === run.strategy?.selectedMarketId);
    if (request.kind !== 'private-payment' && !best) throw new Error('No eligible yield opportunity. Adjust the policy or wait for better evidence.');
    const quotedAt = Date.now();
    const proposal: Proposal = {
      id: run.id, policyId: policy.id, policyVersion: policy.version, nonce: this.ledger.snapshot().nextNonce,
      kind: request.kind, amount: request.amount, asset: 'USDC', venue: request.kind === 'public-lending' ? 'rhea-lending' : 'near-intents',
      counterparty: request.counterparty, privacy: request.kind === 'public-lending' ? 'public' : 'confidential', slippageBps: 25,
      quotedOutput: request.amount, minimumOutput: minimumOutput(request.amount, 25), quotedAt, expiresAt: quotedAt + 60_000,
      purpose: request.kind === 'private-payment' ? 'Pay the approved research agent for its NEAR yield report.' : `Fund a reserve for ${best!.protocol} ${best!.symbol}; no lending deposit is executed.`, mode: 'rehearsal',
      ...(best && request.kind !== 'private-payment' ? { opportunityId: best.id, strategyVenue: best.venue } : {}),
    };
    if (request.attack === 'overspend') proposal.amount = (units(policy.dailyLimit) + 1_000_000n).toString();
    if (request.attack === 'counterparty') proposal.counterparty = 'unapproved-attacker';
    if (request.attack === 'slippage') proposal.slippageBps = policy.maxSlippageBps + 1;
    if (request.attack === 'privacy') proposal.privacy = 'public';
    if (request.attack === 'stale-quote') proposal.quotedAt -= (policy.maxQuoteAgeSeconds + 1) * 1000;
    run.proposal = proposal;
    run.reports.push({ agent: 'strategist', title: 'Proposed use of funds', summary: proposal.purpose, findings: ['The model cannot alter the budget or sign a transfer.', 'This proposal uses a rehearsal quote. It is not a market execution quote.'], marketIds: best ? [best.id] : [], sourceUrls: [research.sourceUrl], completedAt: new Date().toISOString(), inference: 'deterministic' });
    this.transition(run, 'proposed', 2, proposal.purpose);
    this.audit.append('proposal.created', run.id, { proposal, strategy: run.strategy });
    await delay(this.pace);
    this.transition(run, 'checking', 3, 'Checking the current policy and shared allowance atomically.');
    await delay(this.pace);
    // Do not refresh the proposal's version or nonce here: stale concurrent proposals must be rejected.
    const { decision } = this.ledger.reserve(proposal);
    run.decision = decision;
    const guardianReceipt = this.audit.append('guardian.checked', run.id, { proposalId: proposal.id, decision });
    if (!decision.allowed) {
      run.receiptId = guardianReceipt.id;
      run.status = 'blocked'; run.steps[3]!.status = 'blocked'; run.steps[3]!.detail = decision.checks.filter(c => !c.passed).map(c => c.label).join(' · ');
      run.steps[4]!.detail = 'No execution authorization issued.'; run.steps[5]!.detail = 'No funds moved. The denial is sealed in the audit log.'; run.updatedAt = new Date().toISOString();
      return;
    }
    this.transition(run, 'executing', 4, 'Sealing the approved rehearsal instruction. No real transaction is signed.');
    this.audit.append('execution.authorized', run.id, { proposal, disclosure: 'Session rehearsal. No hardware attestation or chain transaction.' });
    await delay(this.pace);
    this.ledger.markDispatched(proposal.id);
    this.audit.append('execution.dispatched', run.id, { mode: 'rehearsal', transactionHash: null });
    this.transition(run, 'settling', 5, 'Recording the rehearsal outcome and signing its encrypted receipt.');
    await delay(this.pace);
    this.ledger.settle(proposal.id);
    run.status = 'settled'; run.steps.forEach(s => s.status = 'complete');
    run.settlement = { status: 'REHEARSAL_SUCCESS', transactionHash: null, message: request.kind === 'allocation-reserve' ? 'Rehearsal reserve funded. No lending position was opened.' : 'Rehearsal completed. No real assets moved.' };
    run.steps[5]!.detail = run.settlement.message;
    run.receiptId = this.audit.append('settlement.recorded', run.id, { proposal, settlement: run.settlement, budget: this.ledger.snapshot() }).id;
    run.updatedAt = new Date().toISOString();
  }
}
