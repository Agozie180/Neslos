import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { canonical, sha256 } from '../core/crypto.js';
import { units } from '../core/amounts.js';
import { nearAccount } from '../core/wire.js';
import { writePrivateJson } from './account.js';

const atomic = z.string().refine(value => { try { units(value); return true; } catch { return false; } });
export const commercePolicySchema = z.object({
  format: z.literal('neslos-commerce-policy-v1'), network: z.literal('mainnet'), account: nearAccount,
  totalLimitAtomic: atomic, perActionLimitAtomic: atomic,
  totalNativeLimitYocto: atomic,
  allowedAgentHandles: z.array(z.string().regex(/^[a-z0-9-]{1,63}$/)).max(32),
  allowPublicLending: z.boolean(),
}).strict();
export type CommercePolicy = z.infer<typeof commercePolicySchema>;
const entrySchema = z.object({
  id: z.string().uuid(), kind: z.enum(['lending-supply', 'lending-withdraw', 'storage', 'agent-job']), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  amount: atomic, nativeAmount: atomic, createdAt: z.iso.datetime(), state: z.enum(['reserved', 'submitted', 'complete', 'unknown']),
  preparation: z.unknown().optional(), result: z.unknown().optional(), observation: z.unknown().optional(),
}).strict();
type Entry = z.infer<typeof entrySchema>;
const ledgerSchema = z.object({ format: z.literal('neslos-commerce-ledger-v1'), account: nearAccount, network: z.literal('mainnet'), entries: z.array(entrySchema).max(1000) }).strict();
type Ledger = z.infer<typeof ledgerSchema>;

/** One owner wallet, one durable lifetime allowance. Withdrawals never refill it. */
export class CommerceBudget {
  private directory: string;
  readonly policy: CommercePolicy;
  constructor(directory: string, policy: CommercePolicy) {
    this.directory = resolve(directory); this.policy = commercePolicySchema.parse(policy);
  }
  private async locked<T>(work: (ledger: Ledger, save: () => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(this.directory, 'commerce.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { throw new Error('COMMERCE_BUSY: another operation or interrupted process owns the journal lock.'); }
    try {
      const path = join(this.directory, 'commerce.json'), marker = join(this.directory, 'commerce.initialized');
      let ledger: Ledger;
      try { ledger = ledgerSchema.parse(JSON.parse(await readFile(path, 'utf8'))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('COMMERCE_JOURNAL_INVALID');
        let initialized = false;
        try { await readFile(marker); initialized = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        if (initialized) throw new Error('COMMERCE_JOURNAL_MISSING');
        ledger = { format: 'neslos-commerce-ledger-v1', account: this.policy.account, network: this.policy.network, entries: [] };
        await writePrivateJson(path, ledger, true);
      }
      if (ledger.account !== this.policy.account || ledger.network !== this.policy.network) throw new Error('COMMERCE_ACCOUNT_CONFLICT');
      try { const initialized = await open(marker, 'wx', 0o600); try { await initialized.writeFile('Keep commerce.json and this marker together.\n'); await initialized.sync(); } finally { await initialized.close(); } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      return await work(ledger, () => writePrivateJson(path, ledgerSchema.parse(ledger)));
    } finally { await lock.close(); await unlink(lockPath); }
  }
  async status() {
    return this.locked(async ledger => ({ account: ledger.account, reservedAtomic: ledger.entries.reduce((n, e) => n + units(e.amount), 0n).toString(), reservedNativeYocto: ledger.entries.reduce((n, e) => n + units(e.nativeAmount), 0n).toString(), operations: ledger.entries.map(({ id, kind, amount, nativeAmount, state, createdAt }) => ({ id, kind, amount, nativeAmount, state, createdAt })) }));
  }
  async once<T>(operation: { id: string; kind: Entry['kind']; amount: string; nativeAmount: string; input: unknown }, prepare: () => Promise<unknown>, dispatch: (prepared: unknown) => Promise<T>): Promise<T> {
    return this.locked(async (ledger, save) => {
      const inputHash = sha256(canonical(operation.input));
      const previous = ledger.entries.find(e => e.id === operation.id);
      if (previous) {
        if (previous.kind !== operation.kind || previous.amount !== operation.amount || previous.nativeAmount !== operation.nativeAmount || previous.inputHash !== inputHash) throw new Error('COMMERCE_OPERATION_CONFLICT');
        if (previous.state === 'complete') return previous.result as T;
        throw new Error('COMMERCE_OUTCOME_UNRESOLVED: observe the existing operation; no replacement payment was sent.');
      }
      // NEAR delegate nonces share the wallet's access key. Another signature could
      // invalidate a still-live agent payment. Reconcile it before signing again.
      if (ledger.entries.some(e => e.kind === 'agent-job' && e.preparation && !(e.observation as { settlementVerified?: boolean; authorizationExpired?: boolean } | undefined)?.settlementVerified && !(e.observation as { authorizationExpired?: boolean } | undefined)?.authorizationExpired)) throw new Error('COMMERCE_PENDING_DELEGATE');
      const amount = units(operation.amount), used = ledger.entries.reduce((n, e) => n + units(e.amount), 0n);
      if (amount > 0n && (units(this.policy.totalLimitAtomic) === 0n || units(this.policy.perActionLimitAtomic) === 0n)) throw new Error('COMMERCE_BUDGET_DISABLED');
      if (amount > units(this.policy.perActionLimitAtomic) || used + amount > units(this.policy.totalLimitAtomic)) throw new Error('COMMERCE_BUDGET_EXHAUSTED');
      const nativeUsed = ledger.entries.reduce((n, e) => n + units(e.nativeAmount), 0n);
      if (nativeUsed + units(operation.nativeAmount) > units(this.policy.totalNativeLimitYocto)) throw new Error('COMMERCE_NATIVE_BUDGET_EXHAUSTED');
      if (ledger.entries.length >= 1000) throw new Error('COMMERCE_HISTORY_LIMIT');
      const entry = entrySchema.parse({ id: operation.id, kind: operation.kind, amount: operation.amount, nativeAmount: operation.nativeAmount, inputHash, createdAt: new Date().toISOString(), state: 'reserved' });
      ledger.entries.push(entry); await save();
      try {
        entry.preparation = await prepare();
        entry.state = 'submitted'; await save(); // Persist before releasing a signature or sending a transaction.
        const result = await dispatch(entry.preparation);
        entry.result = result; entry.state = 'complete'; await save();
        return result;
      } catch {
        entry.state = 'unknown'; await save();
        throw new Error('COMMERCE_OUTCOME_UNRESOLVED: credit remains reserved; inspect the saved operation before retrying.');
      }
    });
  }
  async operation(id: string) {
    return this.locked(async ledger => { const entry = ledger.entries.find(e => e.id === id); if (!entry) throw new Error('COMMERCE_OPERATION_ABSENT'); return structuredClone(entry); });
  }
  /** The service supplies a chain-verifying observer. No quota is ever refilled. */
  async observe<T>(id: string, verify: (entry: Readonly<Entry>) => Promise<T>) {
    return this.locked(async (ledger, save) => {
      const entry = ledger.entries.find(e => e.id === id); if (!entry) throw new Error('COMMERCE_OPERATION_ABSENT');
      const result = await verify(structuredClone(entry));
      entry.observation = result; await save(); return result;
    });
  }
}
