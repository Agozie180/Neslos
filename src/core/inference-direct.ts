import { Quote } from '@phala/dcap-qvl';
import { DirectAttestationClient, DirectInferenceClient, createPinnedTlsFetch, type DirectInferenceClientOptions, type DirectModelAttestation, type DirectTlsBinding, type FetchDirectModelAttestationsParams, type VerifiedDirectModelAttestation } from '@nearai/inference-sdk/node';
import { z } from 'zod';
import { createAddressPinnedFetch } from './inference-tls.js';

export const directInferencePolicySchema = z.object({
  baseUrl: z.string().refine(value => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && /^[a-z0-9-]+\.completions\.near\.ai$/.test(u.hostname) && !u.port && !u.username && !u.password && u.pathname === '/v1' && !u.search && !u.hash;
    } catch { return false; }
  }, 'Expected a direct NEAR HTTPS /v1 endpoint'),
  spkiFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  connectAddress: z.ipv4().optional(),
  thinkingTokenBudget: z.number().int().min(0).max(512).nullable().optional(),
  reasoningEffort: z.literal('none').optional(),
  signingAddress: z.string().regex(/^[a-f0-9]{64}$/),
  instanceId: z.string().regex(/^[a-f0-9]{40}$/),
  approvedUntil: z.iso.datetime(),
  trust: z.literal('reviewed-provider-administration'),
}).strict();
export type DirectInferencePolicy = z.infer<typeof directInferencePolicySchema>;

function requireCurrent(policy: DirectInferencePolicy) {
  if (Date.now() >= Date.parse(policy.approvedUntil)) throw new Error('INFERENCE_APPROVAL_EXPIRED');
}

/** Additional constraints on exact report bytes. The SDK must still verify both
 * quotes, nonce commitments and event-log replay before creating any transport.
 * Matching boot registers alone does not identify a running instance.
 */
export function checkDirectReportAssociation(report: DirectModelAttestation, policy: DirectInferencePolicy) {
  requireCurrent(policy);
  if (report.signer.signingAlgo !== 'ed25519' || report.signer.signingAddress !== policy.signingAddress || report.spkiFingerprint !== policy.spkiFingerprint || report.instanceId !== policy.instanceId) throw new Error('INFERENCE_DIRECT_IDENTITY');
  const manager = report.composeManagerAttestation;
  if (!manager || manager.nonce !== report.nonce) throw new Error('INFERENCE_MANAGER_ASSOCIATION');
  const proxyQuote = Quote.parse(Buffer.from(report.intelQuote.replace(/^0x/, ''), 'hex')).report.asTd10();
  const managerQuote = Quote.parse(Buffer.from(manager.intelQuote.replace(/^0x/, ''), 'hex')).report.asTd10();
  if (!proxyQuote || !managerQuote) throw new Error('INFERENCE_MANAGER_ASSOCIATION');
  for (const field of ['mrTd', 'mrConfigId', 'mrOwner', 'mrOwnerConfig', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3'] as const) {
    if (!Buffer.from(proxyQuote[field]).equals(Buffer.from(managerQuote[field]))) throw new Error('INFERENCE_MANAGER_ASSOCIATION');
  }
  if (!Buffer.from(proxyQuote.reportData).subarray(32).equals(Buffer.from(managerQuote.reportData).subarray(32))) throw new Error('INFERENCE_MANAGER_ASSOCIATION');
  for (const raw of [report.eventLog, manager.eventLog]) {
    const events = z.array(z.object({ imr: z.number(), event: z.string(), event_payload: z.string() })).parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    const ids = events.filter(e => e.imr === 3 && e.event === 'instance-id');
    if (ids.length !== 1 || ids[0]!.event_payload !== policy.instanceId) throw new Error('INFERENCE_MANAGER_ASSOCIATION');
  }
}

/** Retry only the SDK's explicit TLS-handshake pin rejection. No HTTP bytes
 * reached an application in that case. A timeout, status error or unknown paid
 * outcome is never retried. Every attempt keeps the same single approved key.
 */
export function createDirectPinnedFetch(approval: DirectInferencePolicy): typeof fetch {
  const policy = directInferencePolicySchema.parse(approval);
  const tlsFetch = policy.connectAddress ? createAddressPinnedFetch(policy.connectAddress, policy.spkiFingerprint) : createPinnedTlsFetch(policy.spkiFingerprint);
  return async (input, init) => {
    const request = new Request(input, init);
    const u = new URL(request.url);
    if (u.origin !== new URL(policy.baseUrl).origin) throw new Error('INFERENCE_DIRECT_ORIGIN');
    for (let attempt = 0; ; attempt++) {
      requireCurrent(policy);
      try { return await tlsFetch(request.clone()); }
      catch (error) {
        if (attempt >= 5 || (error as { failure?: { code?: string } })?.failure?.code !== 'binding.spki_fingerprint_mismatch' || request.signal.aborted) throw error;
      }
    }
  };
}

class TlsAttestationClient extends DirectAttestationClient {
  constructor(private readonly approval: DirectInferencePolicy) { super({ baseUrl: approval.baseUrl }); }
  override fetchModelAttestations(params: FetchDirectModelAttestationsParams = {}) {
    return this.fetchModelAttestationsWithOptions({ ...params, includeSpkiFingerprint: true });
  }
  protected override async requestAttestation(request: Request) {
    // The handshake has checked this exact fingerprint before a response exists.
    return { response: await createDirectPinnedFetch(this.approval)(request, { signal: AbortSignal.timeout(30000) }), peerSpkiFingerprint: this.approval.spkiFingerprint };
  }
}
class PinnedSignatureClient extends DirectAttestationClient {
  constructor(options: DirectInferenceClientOptions, private readonly pinnedFetch: typeof fetch) { super(options); }
  protected override requestApi(request: Request) { return this.pinnedFetch(request); }
}

/** Opt-in NEAR direct transport. No unpinned fallback or serving-set expansion.
 * The policy explicitly trusts reviewed provider administration for live model
 * state; hardware evidence does not independently measure loaded weight bytes.
 */
export class StrictDirectInferenceClient extends DirectInferenceClient {
  private readonly approval: DirectInferencePolicy;
  private readonly strictAttestations: TlsAttestationClient;
  private readonly strictOptions: DirectInferenceClientOptions;
  constructor(options: DirectInferenceClientOptions, approval: DirectInferencePolicy) {
    const policy = directInferencePolicySchema.parse(approval);
    if (options.baseUrl !== policy.baseUrl || options.e2ee !== true || options.ohttp !== true || options.signingAlgo !== 'ed25519' || options.attestationCacheTimeToLiveMs !== 0) throw new Error('INFERENCE_DIRECT_CONFIGURATION');
    super(options);
    this.approval = policy;
    this.strictOptions = options;
    // Evidence retrieval is public; this object never receives the API key.
    this.strictAttestations = new TlsAttestationClient(policy);
  }
  protected override async fetchModelAttestations() {
    requireCurrent(this.approval);
    const fetched = await this.strictAttestations.fetchModelAttestations({ signingAlgo: 'ed25519' });
    if (fetched.clientBinding.spkiFingerprint !== this.approval.spkiFingerprint) throw new Error('INFERENCE_DIRECT_TLS');
    for (const report of [fetched.servingAttestation, ...fetched.attestations]) checkDirectReportAssociation(report, this.approval);
    return fetched;
  }
  protected override createDirectSessionTransport({ attestations, tlsBinding }: { attestations: readonly VerifiedDirectModelAttestation[]; tlsBinding: DirectTlsBinding }) {
    requireCurrent(this.approval);
    if (tlsBinding.kind !== 'attested' || tlsBinding.spkiFingerprint !== this.approval.spkiFingerprint || !attestations.length) throw new Error('INFERENCE_DIRECT_TLS');
    for (const attestation of attestations) checkDirectReportAssociation(attestation.report, this.approval);
    const pinnedFetch = createDirectPinnedFetch(this.approval);
    const signatures = new PinnedSignatureClient(this.strictOptions, pinnedFetch);
    return { fetch: pinnedFetch, fetchCompletionSignature: (params: Parameters<PinnedSignatureClient['fetchCompletionSignature']>[0]) => signatures.fetchCompletionSignature(params) };
  }
}
