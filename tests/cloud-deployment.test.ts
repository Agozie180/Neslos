import { expect, it, vi } from 'vitest';
const modulePath = '../scripts/cloud.mjs';
const { createReport, deploymentAccountChecks, PHALA_API } = await import(modulePath);
const current = { user: { username: 'private-user', email: 'secret@example.invalid', email_verified: true }, workspace: { slug: 'private-workspace', role: 'OWNER' }, credits: { balance: '5', granted_balance: '0', is_post_paid: true } };
const ok = (value: unknown) => ({ ok: true, value });
const quotas = { quotas: { vm_slots: { limit: 8, remaining: 8 }, vcpu: { limit: 16, remaining: 16 }, memory_mb: { limit: 32768, remaining: 32768 }, disk_gb: { limit: 160, remaining: 160 } } };

it('does not turn verified ownership, active billing and unused quotas into policy acceptance', () => {
  const result = deploymentAccountChecks(current, ok({ billing_status: 'active' }), ok(quotas));
  expect(result).toMatchObject({ emailVerified: true, workspaceRole: 'owner', billingStatus: 'active', quotas: { vmSlots: { remaining: 8 } }, providerPolicyAcceptance: 'not-established' });
  expect(JSON.stringify(result)).not.toMatch(/private-user|secret@example|private-workspace/);
});

it('preserves exposed account and quota failures without claiming which one caused a rejection', () => {
  const result = deploymentAccountChecks({ ...current, user: { email_verified: false } }, ok({ billing_status: 'suspended' }), ok({ quotas: { vm_slots: { limit: 8, remaining: 0 } } }));
  expect(result).toMatchObject({ emailVerified: false, billingStatus: 'suspended', quotas: { vmSlots: { limit: 8, remaining: 0 }, diskGb: null }, providerPolicyAcceptance: 'not-established' });
});

it('keeps absent, malformed and unavailable account checks unknown', () => {
  const result = deploymentAccountChecks({}, { ok: false, status: 'permission-denied' }, { ok: false, status: 'connection-unavailable' });
  expect(result).toMatchObject({ emailVerified: null, workspaceRole: null, billingStatus: null, workspaceStatus: 'permission-denied', quotaStatus: 'connection-unavailable', quotas: { vmSlots: null }, providerPolicyAcceptance: 'not-established' });
  const malformed = deploymentAccountChecks(current, ok(null), ok({ quotas: { vm_slots: { limit: 8, remaining: 9 }, vcpu: { limit: 16, remaining: -1 } } }));
  expect(malformed).toMatchObject({ billingStatus: null, workspaceStatus: 'malformed-response', quotas: { vmSlots: null, vcpu: null } });
});

it('uses only read-only, same-origin workspace checks and does not expose credentials or identity', async () => {
  const key = 'fixture-cloud-key';
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe('GET'); expect(init.body).toBeUndefined(); expect(init.redirect).toBe('error');
    if (url === 'https://cloud-api.near.ai/v1/model/list') return new Response('{"models":[]}');
    expect(url.startsWith(PHALA_API + '/')).toBe(true);
    expect(init.headers).toMatchObject({ 'X-API-Key': key });
    const data = url.endsWith('/auth/me') ? current : url.endsWith('/cvms') ? { items: [] } : url.endsWith('/quotas') ? quotas : { billing_status: 'active', secret: key };
    return new Response(JSON.stringify(data));
  });
  const report = await createReport({ env: { PHALA_CLOUD_API_KEY: key }, deploymentChecks: true, fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(5);
  expect(report.phala.cloud.deploymentChecks).toMatchObject({ billingStatus: 'active', providerPolicyAcceptance: 'not-established' });
  for (const secret of [key, 'private-workspace', 'private-user', 'secret@example.invalid']) expect(JSON.stringify(report)).not.toContain(secret);
  expect(report).toMatchObject({ provisionedInstances: 0, inferenceRequests: 0 });
});
