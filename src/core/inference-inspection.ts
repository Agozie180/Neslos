import { AttestationClient, InferenceClient, type InferenceClientOptions } from '@nearai/inference-sdk/node';
import { sha256 } from './crypto.js';

export interface InferenceWireEvidence {
  kind: 'gateway' | 'model';
  responseSha256: string;
  responseBodyBase64: string;
  report: unknown;
}
const MAX_REPORT_BYTES = 4_000_000;

/** Preserve metadata that SDK normalization omits, without changing SDK verification.
 * VM configuration remains a calculation input, never an automatically approved pin.
 * Reports contain provider identifiers and belong only in private operator evidence.
 */
export class InspectableInferenceClient extends InferenceClient {
  #reports: InferenceWireEvidence[] = [];
  #gateway: AttestationClient;
  #algorithm: 'ed25519' | 'ecdsa';
  constructor(options: InferenceClientOptions) {
    if (options.gatewayVerification?.includeSpkiFingerprint === false) throw new Error('INSPECTION_TLS_PIN_REQUIRED');
    super(options);
    this.#algorithm = options.signingAlgo ?? 'ed25519';
    const capture = (response: Response) => this.capture('gateway', response);
    this.#gateway = new class extends AttestationClient {
      protected override async requestGatewayAttestation(request: Request, capturePeerSpkiFingerprint: boolean) {
        const result = await super.requestGatewayAttestation(request, capturePeerSpkiFingerprint);
        await capture(result.response);
        return result;
      }
    }(options);
  }
  protected override fetchGatewayAttestation() {
    return this.#gateway.fetchGatewayAttestation({ signingAlgo: this.#algorithm, includeSpkiFingerprint: true });
  }
  protected override createGatewayFetch(peerSpkiFingerprint?: string): typeof fetch {
    // super returns the SDK's attested-SPKI-pinned HTTPS transport. Never replace
    // it with ordinary fetch merely to capture a response.
    const pinned = super.createGatewayFetch(peerSpkiFingerprint);
    return async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (request.method !== 'GET') throw new Error('INSPECTION_READ_ONLY');
      const response = await pinned(request);
      if (url.pathname.endsWith('/attestation/report') && url.searchParams.has('model')) await this.capture('model', response);
      return response;
    };
  }
  private async capture(kind: InferenceWireEvidence['kind'], response: Response) {
    if (!response.ok || !response.body) return;
    const copy = response.clone(), reader = copy.body!.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_REPORT_BYTES) {
          await Promise.all([reader.cancel(), response.body.cancel()]);
          throw new Error('INSPECTION_REPORT_TOO_LARGE');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    let report: unknown;
    try { report = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('INSPECTION_REPORT_INVALID'); }
    this.#reports.push({ kind, responseSha256: sha256(bytes), responseBodyBase64: bytes.toString('base64'), report });
  }
  wireEvidence(): InferenceWireEvidence[] { return structuredClone(this.#reports); }
}
