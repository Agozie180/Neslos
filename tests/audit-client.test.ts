import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ command: vi.fn(), delay: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/core/private-client.js', () => ({ privateCommand: mocks.command }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));
import { AuditLog } from '../src/core/audit.js';
import { canonical } from '../src/core/crypto.js';
import { HttpResponseError } from '../src/core/research.js';
import { downloadPrivateAudit, type OwnerRuntime } from '../src/owner/private.js';
beforeEach(() => { vi.clearAllMocks(); });
describe('bounded audit download recovery', () => {
  it('honors rate limits and retries the same snapshot page instead of abandoning a large export', async () => {
    const audit = new AuditLog('attested'); audit.append('test.only', 'run', { fixture: true });
    const bundle = audit.export(), bytes = Buffer.from(canonical(bundle));
    const config: OwnerRuntime = { format: 'neslos-owner-runtime-v1', endpoint: 'https://fixture.invalid', network: 'testnet', vault: 'vault.testnet', executorPublicKey: audit.publicKey,
      teePolicy: { format: 'neslos-tdx-policy-v1', mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48), rtMr3: '55'.repeat(48) } };
    mocks.command.mockRejectedValueOnce(new HttpResponseError(429, 5000)).mockResolvedValueOnce({ ok: true, value: { checkpoint: bundle.checkpoint, offset: 0, totalBytes: bytes.length, chunk: bytes.toString('base64'), nextOffset: null } });
    expect(await downloadPrivateAudit(config, 'aa'.repeat(32))).toEqual(bundle);
    expect(mocks.delay).toHaveBeenCalledWith(5000);
    expect(mocks.command.mock.calls[0]![3]).toEqual(mocks.command.mock.calls[1]![3]);
  });
});
