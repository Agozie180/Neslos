import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AuditLog, verifyAudit } from '../src/core/audit.js';
import { canonical } from '../src/core/crypto.js';
import { AuditJournal } from '../src/tee/journal.js';
let directory: string, path: string, log: AuditLog;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'neslos-journal-')); path = join(directory, 'audit.json'); log = new AuditLog('attested'); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
it('upgrades a legacy journal and preserves every signed checkpoint across segment rotation', async () => {
  log.append('legacy', 'one', { secret: 'private mission' }); const legacy = log.export();
  await writeFile(path, canonical(legacy));
  const journal = new AuditJournal(path, log.publicKey); expect(await journal.load()).toEqual(legacy);
  for (let i = 0; i < 6; i++) log.append('research', String(i), { payload: 'x'.repeat(300000) });
  await journal.save(log.export());
  const originalPages = await readdir(path + '.segments'); expect(originalPages.length).toBeGreaterThan(1);
  log.append('inference.reserved', 'next', { credit: '100' }); await journal.save(log.export());
  const restored = (await new AuditJournal(path, log.publicKey).load())!;
  expect(restored).toEqual(log.export()); expect(verifyAudit(restored, log.publicKey, legacy.checkpoint).valid).toBe(true);
  expect(await readdir(path + '.segments')).toEqual(expect.arrayContaining(originalPages));
  expect(await readFile(path, 'utf8')).not.toContain('private mission');
});
it('retains the last published history when a manifest write is interrupted', async () => {
  const journal = new AuditJournal(path, log.publicKey); log.append('before', 'one', {}); await journal.save(log.export());
  const before = log.export(); log.append('unpublished', 'two', {});
  await mkdir(path + '.pending'); await expect(journal.save(log.export())).rejects.toThrow();
  expect(await new AuditJournal(path, log.publicKey).load()).toEqual(before);
});
it.each(['missing', 'altered'])('refuses a %s segment instead of resetting history and credit', async fault => {
  const journal = new AuditJournal(path, log.publicKey); log.append('paid', 'one', {}); await journal.save(log.export());
  const file = join(path + '.segments', (await readdir(path + '.segments'))[0]!);
  if (fault === 'missing') await rm(file); else await writeFile(file, '[]');
  await expect(new AuditJournal(path, log.publicKey).load()).rejects.toThrow();
});
it('refuses a missing manifest when encrypted history still exists', async () => {
  const journal = new AuditJournal(path, log.publicKey); log.append('paid', 'one', {}); await journal.save(log.export());
  await rm(path); await expect(new AuditJournal(path, log.publicKey).load()).rejects.toThrow('JOURNAL_MANIFEST_MISSING');
});
