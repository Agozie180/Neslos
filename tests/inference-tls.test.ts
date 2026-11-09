import { createHash, X509Certificate } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { rootCertificates } from 'node:tls';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAddressPinnedFetch } from '../src/core/inference-tls.js';

const connection = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: connection.request }));
// Public certificate bytes only; the network boundary below is synthetic.
const certificate = new X509Certificate(rootCertificates[0]!);
const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
let hostname = 'test.completions.near.ai', status = 200, encoding = '', payload = Buffer.from('exact response bytes');
beforeEach(() => {
  vi.clearAllMocks(); hostname = 'test.completions.near.ai'; status = 200; encoding = ''; payload = Buffer.from('exact response bytes');
  connection.request.mockImplementation((url, options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: (body: unknown) => void };
    request.end = () => queueMicrotask(() => {
      const invalid = options.checkServerIdentity(url.hostname, { raw: certificate.raw, subjectaltname: 'DNS:' + hostname });
      if (invalid) { request.emit('error', invalid); return; }
      const incoming = Object.assign(new PassThrough(), { statusCode: status, headers: encoding ? { 'content-encoding': encoding } : { location: 'https://unapproved.invalid/' } });
      callback(incoming); incoming.end(payload);
    });
    return request;
  });
});
afterEach(() => vi.restoreAllMocks());
it('keeps HTTPS hostname validation, SNI and chain verification when choosing an address', async () => {
  const response = await createAddressPinnedFetch('192.0.2.1', pin)('https://test.completions.near.ai/v1/models');
  expect(await response.text()).toBe('exact response bytes');
  const [url, options] = connection.request.mock.calls[0]!;
  expect(url.hostname).toBe('test.completions.near.ai');
  expect(options.rejectUnauthorized).toBe(true); expect(options.agent).toBe(false);
  const resolved = vi.fn(); options.lookup(url.hostname, {}, resolved); expect(resolved).toHaveBeenCalledWith(null, '192.0.2.1', 4);
});
it('rejects a wrong SPKI even on the selected route', async () => {
  await expect(createAddressPinnedFetch('192.0.2.1', '0'.repeat(64))('https://test.completions.near.ai/v1/models')).rejects.toMatchObject({ failure: { code: 'binding.spki_fingerprint_mismatch' } });
});
it('rejects a wrong certificate hostname even when its SPKI is approved', async () => {
  hostname = 'different.invalid';
  await expect(createAddressPinnedFetch('192.0.2.1', pin)('https://test.completions.near.ai/v1/models')).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
});
it('returns redirects without following them or forwarding credentials', async () => {
  status = 302;
  const response = await createAddressPinnedFetch('192.0.2.1', pin)('https://test.completions.near.ai/v1/models', { headers: { Authorization: 'Bearer fixture' } });
  expect(response.status).toBe(302); expect(connection.request).toHaveBeenCalledTimes(1);
});
it('preserves decompressed response bytes for signature verification', async () => {
  encoding = 'gzip'; payload = gzipSync(payload);
  const response = await createAddressPinnedFetch('192.0.2.1', pin)('https://test.completions.near.ai/v1/models');
  expect(await response.text()).toBe('exact response bytes'); expect(response.headers.has('content-encoding')).toBe(false);
});
