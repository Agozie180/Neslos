import { randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { canonical, keyFromSeed, seal, sha256, signHash, unseal, verifyHash } from './crypto.js';
import type { AuditEntry, AuditExport, ExecutionMode } from './types.js';

export const GENESIS = '0'.repeat(64);
const header = (e: AuditEntry) => ({ index: e.index, id: e.id, runId: e.runId, type: e.type, createdAt: e.createdAt, mode: e.mode, previousHash: e.previousHash });

export class AuditLog {
  readonly publicKey: string;
  private readonly signingKey: KeyObject;
  private readonly encryptionKey: Uint8Array;
  private entries: AuditEntry[] = [];
  constructor(private mode: ExecutionMode = 'rehearsal', keys?: { signingSeed: Uint8Array; encryptionKey: Uint8Array }) {
    const pair = keyFromSeed(keys?.signingSeed ?? randomBytes(32)); this.publicKey = pair.publicKey; this.signingKey = pair.privateKey;
    this.encryptionKey = keys?.encryptionKey ?? randomBytes(32);
  }
  append(type: string, runId: string, value: unknown): AuditEntry {
    const metadata = { index: this.entries.length, id: randomUUID(), runId, type, createdAt: new Date().toISOString(), mode: this.mode, previousHash: this.entries.at(-1)?.hash ?? GENESIS };
    const sealed = seal(value, this.encryptionKey, metadata);
    const hash = sha256(canonical({ ...metadata, sealed }));
    const entry = { ...metadata, sealed, hash, signature: signHash(hash, this.signingKey) };
    this.entries.push(entry); return structuredClone(entry);
  }
  export(checkpoint?: string): AuditExport {
    const end = checkpoint === undefined ? this.entries.length : checkpoint === GENESIS ? 0 : this.entries.findIndex(e => e.hash === checkpoint) + 1;
    if (checkpoint !== undefined && checkpoint !== GENESIS && end === 0) throw new Error('AUDIT_CHECKPOINT: checkpoint is absent from this history.');
    const entries = structuredClone(this.entries.slice(0, end));
    return { format: 'neslos-audit-v1', publicKey: this.publicKey, entries, checkpoint: entries.at(-1)?.hash ?? GENESIS, scope: this.mode === 'rehearsal' ? 'session-rehearsal' : 'attested-executor' };
  }
  restore(bundle: AuditExport): void {
    if (this.entries.length || bundle.scope !== this.export().scope || !verifyAudit(bundle, this.publicKey).valid || bundle.entries.some(e => e.mode !== this.mode)) throw new Error('Invalid persisted audit identity, scope, or history.');
    this.entries = structuredClone(bundle.entries);
  }
  open(id: string): unknown { const entry = this.entries.find(e => e.id === id); if (!entry) throw new Error('Receipt not found.'); return unseal(entry.sealed, this.encryptionKey, header(entry)); }
}

export function verifyAudit(bundle: AuditExport, pinnedKey = bundle.publicKey, retainedCheckpoint?: string): { valid: boolean; checked: number; reason: string } {
  if (bundle.format !== 'neslos-audit-v1' || pinnedKey !== bundle.publicKey) return { valid: false, checked: 0, reason: 'Unexpected format or signing identity.' };
  let previous = GENESIS;
  for (let i = 0; i < bundle.entries.length; i++) {
    const entry = bundle.entries[i]!;
    const hash = sha256(canonical({ ...header(entry), sealed: entry.sealed }));
    if (entry.index !== i || entry.previousHash !== previous || hash !== entry.hash || !verifyHash(hash, entry.signature, pinnedKey)) return { valid: false, checked: i, reason: `Entry ${i} has an invalid link, content hash or signature.` };
    previous = hash;
  }
  if (previous !== bundle.checkpoint || (retainedCheckpoint !== undefined && retainedCheckpoint !== GENESIS && !bundle.entries.some(e => e.hash === retainedCheckpoint))) return { valid: false, checked: bundle.entries.length, reason: 'The retained checkpoint does not match this history.' };
  return { valid: true, checked: bundle.entries.length, reason: 'Ciphertext hashes, sequence and Ed25519 signatures verified. Completeness requires an independently retained checkpoint.' };
}
