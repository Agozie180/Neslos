import { beforeEach, expect, it, vi } from 'vitest';
import { sha256 } from '../src/core/crypto.js';
const fixture = vi.hoisted(() => ({ gateway: vi.fn(), pinned: vi.fn(), pin: vi.fn() }));
vi.mock('@nearai/inference-sdk/node', () => ({
  AttestationClient: class {
    async requestGatewayAttestation(request: Request, capture: boolean) { return fixture.gateway(request, capture); }
    async fetchGatewayAttestation(options: unknown) {
      const result = await this.requestGatewayAttestation(new Request('https://cloud-api.near.ai/v1/attestation/report'), true);
      return { normalized: await result.response.json(), options };
    }
  },
  InferenceClient: class {
    constructor(_options: unknown) {}
    createGatewayFetch(pin: string) { fixture.pin(pin); return fixture.pinned; }
  },
}));
import { InspectableInferenceClient } from '../src/core/inference-inspection.js';
class InspectableTestClient extends InspectableInferenceClient {
  gateway() { return this.fetchGatewayAttestation(); }
  transport() { return this.createGatewayFetch('fixture-attested-spki'); }
}
beforeEach(() => vi.resetAllMocks());

it('retains raw VM configuration without consuming the SDK response or recording request credentials', async () => {
  const gateway = { info: { vm_config: { cpu_count: 4, pci_hole64_size: 1125899906842624 } }, quote: 'fixture-gateway' };
  const model = { attestations: [{ info: { vm_config: { cpu_count: 64 } }, quote: 'fixture-model' }] };
  fixture.gateway.mockResolvedValue({ response: Response.json(gateway), peerSpkiFingerprint: 'fixture-attested-spki' });
  fixture.pinned.mockResolvedValue(Response.json(model));
  const client = new InspectableTestClient({ apiKey: 'fixture-secret' });
  await client.gateway();
  const response = await client.transport()('https://cloud-api.near.ai/v1/attestation/report?model=fixture', { headers: { authorization: 'Bearer fixture-secret' } });
  expect(await response.json()).toEqual(model);
  expect(fixture.pin).toHaveBeenCalledWith('fixture-attested-spki');
  expect(fixture.gateway.mock.calls[0]![1]).toBe(true);
  expect(client.wireEvidence()).toEqual([
    { kind: 'gateway', responseSha256: sha256(JSON.stringify(gateway)), responseBodyBase64: Buffer.from(JSON.stringify(gateway)).toString('base64'), report: gateway },
    { kind: 'model', responseSha256: sha256(JSON.stringify(model)), responseBodyBase64: Buffer.from(JSON.stringify(model)).toString('base64'), report: model },
  ]);
  const copy = client.wireEvidence(); copy[0]!.report = null;
  expect(client.wireEvidence()[0]!.report).toEqual(gateway);
  expect(JSON.stringify(client.wireEvidence())).not.toContain('fixture-secret');
});

it('preserves exact response bytes so its hash remains reproducible after saving evidence', async () => {
  const bytes = Buffer.from('{\n  "info" : {"vm_config":{"cpu_count": 4}}, "label": "\\u0061"\n}\n');
  fixture.pinned.mockResolvedValue(new Response(bytes));
  const client = new InspectableTestClient({});
  const response = await client.transport()('https://cloud-api.near.ai/v1/attestation/report?model=fixture');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  const saved = JSON.parse(JSON.stringify(client.wireEvidence()))[0];
  expect(Buffer.from(saved.responseBodyBase64, 'base64')).toEqual(bytes);
  expect(sha256(Buffer.from(saved.responseBodyBase64, 'base64'))).toBe(saved.responseSha256);
  expect(saved.report).toEqual({ info: { vm_config: { cpu_count: 4 } }, label: 'a' });
  expect(sha256(JSON.stringify(saved.report))).not.toBe(saved.responseSha256);
});

it('refuses unpinned setup and non-read requests before invoking transport', async () => {
  expect(() => new InspectableTestClient({ gatewayVerification: { includeSpkiFingerprint: false } })).toThrow('INSPECTION_TLS_PIN_REQUIRED');
  const client = new InspectableTestClient({});
  await expect(client.transport()('https://cloud-api.near.ai/v1/chat/completions', { method: 'POST', body: '{}' })).rejects.toThrow('INSPECTION_READ_ONLY');
  expect(fixture.pinned).not.toHaveBeenCalled();
});

it('propagates TLS transport rejection and rejects malformed or excessive evidence', async () => {
  const url = 'https://cloud-api.near.ai/v1/attestation/report?model=fixture';
  const client = new InspectableTestClient({});
  fixture.pinned.mockRejectedValueOnce(new Error('TLS_PIN_MISMATCH'));
  await expect(client.transport()(url)).rejects.toThrow('TLS_PIN_MISMATCH');
  fixture.pinned.mockResolvedValueOnce(new Response('invalid'));
  await expect(client.transport()(url)).rejects.toThrow('INSPECTION_REPORT_INVALID');
  fixture.pinned.mockResolvedValueOnce(new Response('x'.repeat(4_000_001)));
  await expect(client.transport()(url)).rejects.toThrow('INSPECTION_REPORT_TOO_LARGE');
  expect(client.wireEvidence()).toEqual([]);
});
