import { createHash, X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { checkServerIdentity } from 'node:tls';
import { createBrotliDecompress, createGunzip } from 'node:zlib';
import { VerificationError } from '@nearai/inference-sdk/node';

/** Connect to a reviewed address while retaining the original HTTPS hostname,
 * SNI, certificate-chain validation and exact SPKI check. The address chooses a
 * route, never a trust identity. Redirects are returned, never followed.
 */
export function createAddressPinnedFetch(address: string, fingerprint: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.protocol !== 'https:') throw new Error('INFERENCE_DIRECT_TLS');
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    const headers = new Headers(request.headers);
    headers.set('accept-encoding', 'identity');
    return new Promise<Response>((resolve, reject) => {
      const outgoing = httpsRequest(url, {
        agent: false, family: 4,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
        method: request.method, headers: Object.fromEntries(headers),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
        rejectUnauthorized: true,
        checkServerIdentity: (hostname, certificate) => {
          const invalid = checkServerIdentity(hostname, certificate);
          if (invalid) return invalid;
          const actual = createHash('sha256').update(new X509Certificate(certificate.raw).publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
          return actual === fingerprint ? undefined : new VerificationError({ code: 'binding.spki_fingerprint_mismatch' });
        },
      }, incoming => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const v of value) responseHeaders.append(name, v);
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        const status = incoming.statusCode ?? 500;
        const empty = request.method === 'HEAD' || [204, 205, 304].includes(status);
        const encoding = responseHeaders.get('content-encoding');
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : undefined;
        if (decoder) { incoming.on('error', error => decoder.destroy(error)); incoming.pipe(decoder); responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length'); }
        if (empty) incoming.resume();
        resolve(new Response(empty ? null : Readable.toWeb(decoder ?? incoming) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      });
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  };
}
