import { units, utcDay } from './amounts.js';
import { canonical, sha256 } from './crypto.js';
import { checkPolicy, policySchema } from './policy.js';
import type { BudgetSnapshot, GuardianDecision, Policy, Proposal } from './types.js';

interface Reservation { id: string; fingerprint: string; amount: bigint; day: string; status: 'reserved' | 'dispatched' | 'settled' | 'dispatch-failed' | 'unknown'; decision: GuardianDecision }
export interface PolicyLedgerState {
  active: Policy;
  usage: [string, string][];
  reservations: (Omit<Reservation, 'amount'> & { amount: string })[];
  nonce: string;
  balance: string;
}

/** Session rehearsal only. Real authority lives in the Rust contract. All mutations are synchronous. */
export class PolicyLedger {
  private active: Policy;
  private usage = new Map<string, bigint>();
  private reservations = new Map<string, Reservation>();
  private nonce = 0n;
  private balance: bigint;
  constructor(policy: Policy, balance = '10000000000', private clock = () => Date.now()) { this.active = policySchema.parse(policy); this.balance = units(balance); }
  static restore(state: PolicyLedgerState, clock = () => Date.now()): PolicyLedger {
    const ledger = new PolicyLedger(state.active, state.balance, clock);
    ledger.usage = new Map(state.usage.map(([day, amount]) => [day, units(amount)]));
    ledger.reservations = new Map(state.reservations.map(reservation => [reservation.id, { ...reservation, amount: units(reservation.amount) }]));
    ledger.nonce = units(state.nonce);
    return ledger;
  }
  exportState(): PolicyLedgerState {
    return {
      active: this.policy,
      usage: [...this.usage].map(([day, amount]) => [day, amount.toString()]),
      reservations: [...this.reservations.values()].map(reservation => ({ ...structuredClone(reservation), amount: reservation.amount.toString() })),
      nonce: this.nonce.toString(),
      balance: this.balance.toString(),
    };
  }
  get policy(): Policy { return structuredClone(this.active); }
  snapshot(): BudgetSnapshot {
    const day = utcDay(this.clock());
    const spent = this.usage.get(day) ?? 0n;
    let reserved = 0n;
    for (const r of this.reservations.values()) if (r.day === day && r.status === 'reserved') reserved += r.amount;
    const remaining = units(this.active.dailyLimit) > spent ? units(this.active.dailyLimit) - spent : 0n;
    return { day, spent: spent.toString(), reserved: reserved.toString(), remaining: remaining.toString(), balance: this.balance.toString(), nextNonce: this.nonce.toString(), reservations: this.reservations.size };
  }
  update(policy: Policy, expectedVersion: number): Policy {
    if (expectedVersion !== this.active.version) throw new Error('POLICY_CONFLICT: reload the latest policy.');
    const parsed = policySchema.parse(policy);
    if (parsed.id !== this.active.id) throw new Error('POLICY_ID: a vault cannot change its identity.');
    this.active = { ...parsed, version: this.active.version + 1 };
    return this.policy;
  }
  preview(proposal: Proposal): GuardianDecision { return checkPolicy(this.active, proposal, this.snapshot(), this.clock()); }
  reserve(proposal: Proposal): { duplicate: boolean; decision: GuardianDecision } {
    const fingerprint = sha256(canonical(proposal));
    const existing = this.reservations.get(proposal.id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT: the request changed.');
      return { duplicate: true, decision: structuredClone(existing.decision) };
    }
    if (this.reservations.size >= 1000) throw new Error('SESSION_LIMIT: start a new rehearsal session.');
    const decision = this.preview(proposal);
    if (!decision.allowed) return { duplicate: false, decision };
    const day = utcDay(this.clock());
    const amount = units(proposal.amount);
    this.usage.set(day, (this.usage.get(day) ?? 0n) + amount);
    this.balance -= amount;
    this.nonce += 1n;
    this.reservations.set(proposal.id, { id: proposal.id, fingerprint, amount, day, status: 'reserved', decision: structuredClone(decision) });
    return { duplicate: false, decision };
  }
  markDispatched(id: string): void { const r = this.mustGet(id); if (r.status === 'dispatched') return; if (r.status !== 'reserved') throw new Error('INVALID_TRANSITION'); r.status = 'dispatched'; }
  settle(id: string): void { const r = this.mustGet(id); if (r.status === 'settled') return; if (r.status !== 'dispatched' && r.status !== 'unknown') throw new Error('INVALID_TRANSITION'); r.status = 'settled'; }
  markUnknown(id: string): void { const r = this.mustGet(id); if (r.status !== 'dispatched') throw new Error('INVALID_TRANSITION'); r.status = 'unknown'; }
  failDispatch(id: string): void {
    const r = this.mustGet(id);
    if (r.status === 'dispatch-failed') return;
    if (r.status !== 'reserved') throw new Error('UNSAFE_REFUND: an observed chain failure is required after dispatch.');
    this.usage.set(r.day, (this.usage.get(r.day) ?? 0n) - r.amount);
    this.balance += r.amount;
    r.status = 'dispatch-failed';
  }
  private mustGet(id: string): Reservation { const r = this.reservations.get(id); if (!r) throw new Error('UNKNOWN_RESERVATION'); return r; }
}
