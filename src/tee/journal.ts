import { mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { GENESIS, verifyAudit } from '../core/audit.js';
import { canonical, sha256 } from '../core/crypto.js';
import type { AuditEntry, AuditExport } from '../core/types.js';
import { hashHex } from '../core/wire.js';

export const JOURNAL_LIMIT_BYTES = 128_000_000;
export const JOURNAL_COMMAND_LIMIT = 10_000;
const SEGMENT_BYTES = 2_000_000;
const manifestSchema = z.object({
  format: z.literal('neslos-journal-v2'), publicKey: hashHex, checkpoint: hashHex,
  segments: z.array(z.object({ hash: hashHex, bytes: z.number().int().positive().max(8_000_000), count: z.number().int().positive() }).strict()).max(40_000),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;

async function atomicWrite(path: string, data: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path + '.pending', 'w', 0o600);
  try { await file.writeFile(data, 'utf8'); await file.sync(); } finally { await file.close(); }
  await rename(path + '.pending', path);
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

/** Immutable encrypted segments; publish the manifest only after every new segment is durable.
 * Keep the manifest AND its .segments directory. Neither rotation nor restart resets credit or IDs.
 * A crash can leave unreferenced segments, but cannot publish a partially written history.
 */
export class AuditJournal {
  private manifest?: Manifest;
  private committedCount = 0;
  private committedCheckpoint = GENESIS;
  readonly path: string;
  constructor(path: string, private publicKey: string) { this.path = resolve(path); }
  async load(): Promise<AuditExport | undefined> {
    let raw: unknown;
    try {
      if ((await stat(this.path)).size > 32_000_000) throw new Error('JOURNAL_MANIFEST_LIMIT');
      raw = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let files: string[] = [];
      try { files = await readdir(this.path + '.segments'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      if (files.length) throw new Error('JOURNAL_MANIFEST_MISSING: existing segments require recovery; credit history cannot be reset.');
      return undefined;
    }
    let bundle: AuditExport;
    if ((raw as { format?: string }).format === 'neslos-audit-v1') {
      // Upgrade existing journals without deleting their history or changing the executor.
      bundle = raw as AuditExport;
    } else {
      const manifest = manifestSchema.parse(raw);
      if (manifest.publicKey !== this.publicKey || manifest.segments.reduce((sum, s) => sum + s.bytes, 0) > JOURNAL_LIMIT_BYTES) throw new Error('JOURNAL_IDENTITY_OR_CAPACITY');
      const entries: AuditEntry[] = [];
      for (const segment of manifest.segments) {
        const path = join(this.path + '.segments', segment.hash + '.json');
        if ((await stat(path)).size !== segment.bytes) throw new Error('JOURNAL_SEGMENT_SIZE');
        const data = await readFile(path, 'utf8');
        if (sha256(data) !== segment.hash) throw new Error('JOURNAL_SEGMENT_HASH');
        const page = JSON.parse(data) as AuditEntry[];
        if (!Array.isArray(page) || page.length !== segment.count) throw new Error('JOURNAL_SEGMENT_COUNT');
        entries.push(...page);
      }
      bundle = { format: 'neslos-audit-v1', publicKey: manifest.publicKey, entries, checkpoint: manifest.checkpoint, scope: 'attested-executor' };
      this.manifest = manifest;
    }
    if (bundle.scope !== 'attested-executor' || !verifyAudit(bundle, this.publicKey).valid) throw new Error('JOURNAL_VERIFICATION');
    this.committedCount = bundle.entries.length; this.committedCheckpoint = bundle.checkpoint;
    return bundle;
  }
  async save(bundle: AuditExport) {
    if (bundle.publicKey !== this.publicKey || bundle.entries.length < this.committedCount || (this.committedCount && bundle.entries[this.committedCount - 1]?.hash !== this.committedCheckpoint)) throw new Error('JOURNAL_HISTORY_CHANGED');
    const manifest: Manifest = { format: 'neslos-journal-v2', publicKey: this.publicKey, checkpoint: bundle.checkpoint, segments: [...(this.manifest?.segments ?? [])] };
    const pending = bundle.entries.slice(this.manifest ? this.committedCount : 0);
    let page: AuditEntry[] = [], size = 2;
    const flush = async () => {
      if (!page.length) return;
      const data = canonical(page), bytes = Buffer.byteLength(data), hash = sha256(data);
      if (bytes > 8_000_000 || manifest.segments.reduce((sum, s) => sum + s.bytes, 0) + bytes > JOURNAL_LIMIT_BYTES) throw new Error('JOURNAL_CAPACITY: export and retain the complete history before planning a new runtime.');
      await atomicWrite(join(this.path + '.segments', hash + '.json'), data);
      manifest.segments.push({ hash, bytes, count: page.length }); page = []; size = 2;
    };
    for (const entry of pending) {
      const bytes = Buffer.byteLength(canonical(entry)) + 1;
      if (page.length && size + bytes > SEGMENT_BYTES) await flush();
      page.push(entry); size += bytes;
    }
    await flush();
    manifestSchema.parse(manifest);
    await atomicWrite(this.path, canonical(manifest));
    this.manifest = manifest; this.committedCount = bundle.entries.length; this.committedCheckpoint = bundle.checkpoint;
  }
}
