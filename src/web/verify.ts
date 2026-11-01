import type { AuditExport } from '../core/types.js';
function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value !== null) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  throw new Error('Unencodable audit data.');
}
function bytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[a-f0-9]+$/.test(hex) || hex.length % 2) throw new Error('Invalid hexadecimal encoding.');
  return Uint8Array.from(hex.match(/../g)!.map(x => parseInt(x, 16)));
}
function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
export async function verifyInBrowser(bundle: AuditExport, pinnedKey: string, retainedCheckpoint?: string) {
  try {
    if (bundle.format !== 'neslos-audit-v1' || pinnedKey !== bundle.publicKey || !/^[a-f0-9]{64}$/.test(pinnedKey) || !Array.isArray(bundle.entries) || bundle.entries.length > 2000) throw new Error('Unexpected format or signing identity.');
    const key = await crypto.subtle.importKey('raw', bytes(pinnedKey), { name: 'Ed25519' }, false, ['verify']);
    let previous = '0'.repeat(64);
    let checkpointSeen = !retainedCheckpoint || retainedCheckpoint === previous;
    for (let i = 0; i < bundle.entries.length; i++) {
      const e = bundle.entries[i]!;
      const data = { index: e.index, id: e.id, runId: e.runId, type: e.type, createdAt: e.createdAt, mode: e.mode, previousHash: e.previousHash, sealed: e.sealed };
      const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(data))));
      if (e.index !== i || e.previousHash !== previous || e.hash !== hash || e.signature.length !== 128 || !await crypto.subtle.verify('Ed25519', key, bytes(e.signature), bytes(hash))) throw new Error('Entry ' + i + ' failed its content, chain, or signature check.');
      previous = hash;
      if (hash === retainedCheckpoint) checkpointSeen = true;
    }
    if (previous !== bundle.checkpoint || !checkpointSeen) throw new Error('This history omits the retained checkpoint.');
    return { valid: true, checked: bundle.entries.length, reason: 'Verified in your browser. All hashes, links, and Ed25519 signatures match.' };
  } catch (error) { return { valid: false, checked: 0, reason: error instanceof Error ? error.message : 'Invalid audit bundle.' }; }
}
