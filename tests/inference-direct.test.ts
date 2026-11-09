import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Quote } from '@phala/dcap-qvl';
import type { DirectModelAttestation } from '@nearai/inference-sdk/node';
import { checkDirectReportAssociation, createDirectPinnedFetch, directInferencePolicySchema, StrictDirectInferenceClient } from '../src/core/inference-direct.js';
import { createVerifiedInferenceClient } from '../src/core/inference.js';
import { inferenceBootFixture, modelDeploymentFixture } from './fixtures/inference.js';

const transport = vi.hoisted(() => ({ fetch: vi.fn(), pins: vi.fn() }));
vi.mock('@nearai/inference-sdk/node', async original => ({ ...await original<typeof import('@nearai/inference-sdk/node')>(), createPinnedTlsFetch: (pins: unknown) => { transport.pins(pins); return transport.fetch; } }));
const approval = { baseUrl: 'https://test.completions.near.ai/v1', spkiFingerprint: 'a'.repeat(64), signingAddress: 'b'.repeat(64), instanceId: 'c'.repeat(40), approvedUntil: '2099-01-01T00:00:00Z', trust: 'reviewed-provider-administration' as const };
const options = { baseUrl: approval.baseUrl, apiKey: 'fixture-key', e2ee: true, ohttp: true, signingAlgo: 'ed25519' as const, attestationCacheTimeToLiveMs: 0 };
class Exposed extends StrictDirectInferenceClient { session(params: Parameters<StrictDirectInferenceClient['createDirectSessionTransport']>[0]) { return this.createDirectSessionTransport(params); } }
const eventLog = [{ imr: 3, event: 'instance-id', event_payload: approval.instanceId }];
function report(): DirectModelAttestation { return { signer: { signingAlgo: 'ed25519', signingAddress: approval.signingAddress }, spkiFingerprint: approval.spkiFingerprint, instanceId: approval.instanceId, nonce: 'd'.repeat(64), intelQuote: '00', eventLog, composeManagerAttestation: { intelQuote: '01', nonce: 'd'.repeat(64), eventLog, actions: [], actionsHash: 'e'.repeat(64) } } as unknown as DirectModelAttestation; }
const quote = () => Object.fromEntries(['mrTd', 'mrConfigId', 'mrOwner', 'mrOwnerConfig', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3', 'reportData'].map(k => [k, Buffer.alloc(k === 'reportData' ? 64 : 48)]));
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Quote, 'parse').mockImplementation(() => ({ report: { asTd10: quote } }) as unknown as ReturnType<typeof Quote.parse>); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('strict direct NEAR transport', () => {
  it.each(['http://test.completions.near.ai/v1', 'https://evil.invalid/v1', 'https://test.completions.near.ai/v1?x=1', 'https://user@test.completions.near.ai/v1', 'https://test.completions.near.ai:8443/v1'])('rejects an unsafe endpoint %s', baseUrl => {
    expect(directInferencePolicySchema.safeParse({ ...approval, baseUrl }).success).toBe(false);
  });
  it.each([{ e2ee: false }, { ohttp: false }, { signingAlgo: 'ecdsa' }, { attestationCacheTimeToLiveMs: 1000 }])('rejects weaker transport options %j', override => {
    expect(() => new StrictDirectInferenceClient({ ...options, ...override } as any, approval)).toThrow('INFERENCE_DIRECT_CONFIGURATION');
  });
  it('creates the direct client only through an explicitly scoped trust policy', () => {
    const model = { osImageHash: 'a'.repeat(64), composeHash: 'b'.repeat(64), boot: inferenceBootFixture };
    expect(createVerifiedInferenceClient({ direct: approval, model, modelId: 'fixture', modelDeployment: modelDeploymentFixture }, 'fixture')).toBeInstanceOf(StrictDirectInferenceClient);
    expect(() => createVerifiedInferenceClient({ direct: { ...approval, trust: undefined }, model, modelId: 'fixture', modelDeployment: modelDeploymentFixture } as any, 'fixture')).toThrow();
  });
  it('rejects missing/wrong TLS bindings without creating a fallback transport', () => {
    const client = new Exposed(options, approval);
    for (const tlsBinding of [{ kind: 'unbound' }, { kind: 'attested', spkiFingerprint: 'f'.repeat(64) }]) expect(() => client.session({ attestations: [{ report: report() }], tlsBinding } as any)).toThrow('INFERENCE_DIRECT_TLS');
    expect(transport.pins).not.toHaveBeenCalled();
  });
  it('pins only the approved peer for requests and signature lookups and rejects cross-origin routing', async () => {
    const client = new Exposed(options, approval);
    const s = client.session({ attestations: [{ report: report() }] as any, tlsBinding: { kind: 'attested', spkiFingerprint: approval.spkiFingerprint } });
    expect(transport.pins).toHaveBeenCalledWith(approval.spkiFingerprint);
    transport.fetch.mockResolvedValue(new Response('{}'));
    await s.fetch(approval.baseUrl + '/chat/completions');
    await expect(s.fetch('https://evil.invalid/ohttp')).rejects.toThrow('INFERENCE_DIRECT_ORIGIN');
    await s.fetchCompletionSignature({ completionId: 'fixture', signingAlgo: 'ed25519' } as any).catch(() => {});
    const signatureRequest = transport.fetch.mock.calls.at(-1)![0] as Request;
    expect(signatureRequest.url).toContain('/signature/fixture');
    expect(signatureRequest.headers.get('authorization')).toBe('Bearer fixture-key');
  });
  it('checks approval expiry again when an existing session sends a request', async () => {
    const client = new Exposed(options, approval);
    const s = client.session({ attestations: [{ report: report() }] as any, tlsBinding: { kind: 'attested', spkiFingerprint: approval.spkiFingerprint } });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(approval.approvedUntil));
    await expect(s.fetch(approval.baseUrl)).rejects.toThrow('INFERENCE_APPROVAL_EXPIRED');
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it('retries rejected TLS handshakes with identical bytes, but never unknown outcomes', async () => {
    transport.fetch.mockRejectedValueOnce({ failure: { code: 'binding.spki_fingerprint_mismatch' } }).mockImplementation(async (r: Request) => Response.json({ body: await r.text() }));
    const send = createDirectPinnedFetch(approval);
    const r = await send(approval.baseUrl + '/ohttp', { method: 'POST', body: 'encrypted-fixture' });
    expect(await r.json()).toEqual({ body: 'encrypted-fixture' });
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    transport.fetch.mockClear().mockRejectedValue(new Error('unknown outcome'));
    await expect(send(approval.baseUrl, { method: 'POST', body: 'encrypted-fixture' })).rejects.toThrow('unknown outcome');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds repeated TLS rejection without admitting another peer', async () => {
    transport.fetch.mockRejectedValue({ failure: { code: 'binding.spki_fingerprint_mismatch' } });
    await expect(createDirectPinnedFetch(approval)(approval.baseUrl)).rejects.toMatchObject({ failure: { code: 'binding.spki_fingerprint_mismatch' } });
    expect(transport.fetch).toHaveBeenCalledTimes(6);
    expect(transport.pins).toHaveBeenCalledWith(approval.spkiFingerprint);
  });
});

describe('proxy/manager report association before SDK authentication', () => {
  it('accepts matching constraints but still constructs a client with real hardware verifiers', () => { expect(() => checkDirectReportAssociation(report(), approval)).not.toThrow(); });
  it.each(['spkiFingerprint', 'instanceId', 'signer'] as const)('rejects a changed %s', field => {
    const r = structuredClone(report()) as any; r[field] = field === 'signer' ? { signingAlgo: 'ed25519', signingAddress: 'f'.repeat(64) } : 'f'.repeat(64);
    expect(() => checkDirectReportAssociation(r, approval)).toThrow('INFERENCE_DIRECT_IDENTITY');
  });
  it.each(['mrConfigId', 'rtMr3', 'mrTd', 'reportData'])('rejects different quoted %s even with matching metadata', field => {
    const changed = quote(); changed[field] = Buffer.alloc(field === 'reportData' ? 64 : 48, 1);
    vi.mocked(Quote.parse).mockReturnValueOnce({ report: { asTd10: quote } } as any).mockReturnValueOnce({ report: { asTd10: () => changed } } as any);
    expect(() => checkDirectReportAssociation(report(), approval)).toThrow('INFERENCE_MANAGER_ASSOCIATION');
  });
  it.each(['missing', 'different', 'duplicate'])('rejects %s instance events in the manager', kind => {
    const r = structuredClone(report()) as any;
    r.composeManagerAttestation.eventLog = kind === 'missing' ? [] : kind === 'duplicate' ? [...eventLog, ...eventLog] : [{ ...eventLog[0], event_payload: 'f'.repeat(40) }];
    expect(() => checkDirectReportAssociation(r, approval)).toThrow('INFERENCE_MANAGER_ASSOCIATION');
  });
});
