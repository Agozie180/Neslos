import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

// Runtime import keeps these dependency-free Node CLI helpers out of the app bundle.
const scriptPath = '../scripts/cloud.mjs';
const { createReport, resolveEnvironment, loadConfiguration, PHALA_API } = await import(scriptPath);
const aiKey = 'fixture-private-ai-credential';
const cloudKey = 'fixture-cloud-credential';
const nearKey = 'fixture-near-credential';
const account = {
  user: { username: 'private-owner', email: 'owner@example.invalid' },
  workspace: { slug: 'private-workspace' },
  credits: { balance: '5.000000', granted_balance: '0.000000', is_post_paid: false, secret: aiKey },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function network(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit) => {
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeUndefined();
    if (url === 'https://cloud-api.near.ai/v1/model/list') {
      expect(init.headers).toEqual({ accept: 'application/json' });
      return json({ models: [{ modelId: 'fixture-model', inputCostPerToken: 0.000001, outputCostPerToken: 0.000002, metadata: { verifiable: true, attestationSupported: true, providerType: 'vllm', contextLength: 1024 } }] });
    }
    return handler(url, init);
  });
}
const unavailable = () => { throw new Error('Unexpected request'); };

describe('read-only cloud credential diagnostics', () => {
  it('identifies the original Private AI credential mislabeled as a Cloud key', async () => {
    const fetchImpl = network((url, init) => {
      if (url === PHALA_API + '/auth/me') {
        expect(init.headers).toMatchObject({ 'X-API-Key': aiKey, 'X-Phala-Version': '2026-06-23' });
        return json({ detail: 'Invalid API key ' + aiKey }, 401);
      }
      expect(url).toBe(PHALA_API + '/private_ai/self');
      expect(init.headers).toMatchObject({ authorization: 'Bearer ' + aiKey });
      return json(account);
    });
    const result = await createReport({ env: { PHALA_CLOUD_API_KEY: aiKey }, fetchImpl });
    expect(result.phala.cloud).toMatchObject({ authenticated: false, status: 'credential-scope-mismatch', credentialService: 'privateAi', authenticatedForOtherService: true, credits: { balance: '5.000000' } });
    expect(result.phala.cloud.nextStep).toContain('PHALA_AI_API_KEY');
    expect(result.phala.privateAi.status).toBe('not-configured');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain(aiKey);
    expect(JSON.stringify(result)).not.toContain('private-owner');
    expect(result).toMatchObject({ inferenceRequests: 0, provisionedInstances: 0 });
  });

  it('uses the corrected key only for Private AI and never lists or creates CVMs', async () => {
    const fetchImpl = network((url, init) => {
      expect(url).toBe(PHALA_API + '/private_ai/self');
      expect(init.method).toBe('GET');
      expect(init.headers).toMatchObject({ authorization: 'Bearer ' + aiKey });
      return json(account);
    });
    const result = await createReport({ env: { PHALA_AI_API_KEY: aiKey }, fetchImpl });
    expect(result.phala.privateAi).toMatchObject({ authenticated: true, credits: { balance: '5.000000', grantedBalance: '0.000000' } });
    expect(result.phala.cloud).toMatchObject({ configured: false, authenticated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('authenticates the two scopes independently and allowlists management output', async () => {
    const fetchImpl = network((url, init) => {
      if (url === 'https://cloud-api.near.ai/v1/check_api_key') {
        expect(init.method).toBe('POST');
        expect(init.headers).toMatchObject({ authorization: 'Bearer ' + nearKey });
        return json({ valid: true });
      }
      expect(init.method).toBe('GET');
      if (url.endsWith('/private_ai/self')) {
        expect(init.headers).toMatchObject({ authorization: 'Bearer ' + aiKey });
        return json(account);
      }
      expect(init.headers).toMatchObject({ 'X-API-Key': cloudKey });
      if (url.endsWith('/auth/me')) return json(account);
      expect(url).toBe(PHALA_API + '/cvms');
      return json({ items: [{ id: 1, env: { secret: cloudKey }, compose: nearKey, name: 'private-resource' }] });
    });
    const result = await createReport({ env: { PHALA_AI_API_KEY: aiKey, PHALA_CLOUD_API_KEY: cloudKey, NEARAI_API_KEY: nearKey }, fetchImpl });
    expect(result.phala.cloud).toMatchObject({ authenticated: true, credits: { isPostPaid: false }, instances: { status: 'available', returnedCount: 1 } });
    expect(result.nearAi.authenticated).toBe(true);
    for (const privateText of [aiKey, cloudKey, nearKey, 'owner@example.invalid', 'private-resource']) expect(JSON.stringify(result)).not.toContain(privateText);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('detects the reverse scope mismatch without interpreting it as Private AI access', async () => {
    const fetchImpl = network(url => url.endsWith('/auth/me') ? json(account) : json({}, 401));
    const result = await createReport({ env: { PHALA_AI_API_KEY: cloudKey }, fetchImpl });
    expect(result.phala.privateAi).toMatchObject({ authenticated: false, status: 'credential-scope-mismatch', credentialService: 'cloud' });
    expect(result.phala.cloud.configured).toBe(false);
  });

  it('does not treat missing keys or a public model catalogue as authentication', async () => {
    const fetchImpl = network(unavailable);
    const result = await createReport({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.phala.privateAi.authenticated).toBe(false);
    expect(result.phala.cloud.authenticated).toBe(false);
    expect(result.modelCatalog).toEqual({ authenticatedEndpoint: false, status: 'available' });
  });

  it('distinguishes a key rejected by both authenticated endpoints from a scope mismatch', async () => {
    const fetchImpl = network(() => json({ detail: aiKey }, 401));
    const result = await createReport({ env: { PHALA_CLOUD_API_KEY: aiKey }, fetchImpl });
    expect(result.phala.cloud).toMatchObject({ authenticated: false, status: 'unauthorized', otherServiceStatus: 'unauthorized' });
    expect(result.phala.cloud.credentialService).toBeUndefined();
  });

  it.each([[403, 'permission-denied'], [429, 'rate-limited'], [500, 'http-error']])('reports HTTP %s without trying another credential scope', async (code, status) => {
    const fetchImpl = network(() => json({ detail: aiKey }, Number(code)));
    const result = await createReport({ env: { PHALA_CLOUD_API_KEY: aiKey }, fetchImpl });
    expect(result.phala.cloud).toMatchObject({ authenticated: false, httpStatus: code, status });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(aiKey);
  });

  it.each([null, [], {}, { user: {}, workspace: {}, credits: { balance: '5' } }, { ...account, credits: { balance: 'NaN', granted_balance: '0' } }])('rejects malformed successful account responses: %j', async value => {
    const result = await createReport({ env: { PHALA_AI_API_KEY: aiKey }, fetchImpl: network(() => json(value)) });
    expect(result.phala.privateAi).toMatchObject({ authenticated: false, status: 'malformed-response' });
  });

  it('distinguishes invalid JSON from transport failure and keeps exception content private', async () => {
    const invalid = await createReport({ env: { PHALA_AI_API_KEY: aiKey }, fetchImpl: network(() => new Response('<html>' + aiKey)) });
    expect(invalid.phala.privateAi.status).toBe('malformed-response');
    const offline = await createReport({ env: { PHALA_CLOUD_API_KEY: cloudKey }, fetchImpl: network(() => { throw new Error(cloudKey); }) });
    expect(offline.phala.cloud.status).toBe('connection-unavailable');
    expect(JSON.stringify(offline)).not.toContain(cloudKey);
  });

  it('does not mistake an unreachable alternative endpoint for a confirmed invalid key', async () => {
    const fetchImpl = network(url => { if (url.endsWith('/auth/me')) return json({}, 401); throw new Error('offline'); });
    const result = await createReport({ env: { PHALA_CLOUD_API_KEY: aiKey }, fetchImpl });
    expect(result.phala.cloud).toMatchObject({ status: 'unauthorized', otherServiceStatus: 'connection-unavailable' });
  });

  it('deduplicates the account probe when both variables contain the same key', async () => {
    const fetchImpl = network(url => url.endsWith('/private_ai/self') ? json(account) : json({}, 401));
    const result = await createReport({ env: { PHALA_AI_API_KEY: aiKey, PHALA_CLOUD_API_KEY: aiKey }, fetchImpl });
    expect(result.phala.privateAi.authenticated).toBe(true);
    expect(result.phala.cloud.status).toBe('credential-scope-mismatch');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps inventory failure separate from authentication and never assumes a zero-resource bill', async () => {
    const fetchImpl = network(url => url.endsWith('/auth/me') ? json({ ...account, credits: undefined }) : json({}, 403));
    const result = await createReport({ env: { PHALA_CLOUD_API_KEY: cloudKey }, fetchImpl });
    expect(result.phala.cloud).toMatchObject({ authenticated: true, credits: { balance: null, isPostPaid: null }, instances: { status: 'permission-denied' } });
  });

  it.each([{}, null, { valid: 'true' }])('requires a boolean from the NEAR validity endpoint: %j', async value => {
    const result = await createReport({ env: { NEARAI_API_KEY: nearKey }, fetchImpl: network(() => json(value)) });
    expect(result.nearAi).toMatchObject({ authenticated: false, status: 'malformed-response' });
  });

  it('preserves small catalogue prices and redacts reflected credentials without corrupting JSON', async () => {
    const secret = 'fixture-"secret"';
    const fetchImpl = vi.fn(async () => json({ models: [{ modelId: secret, inputCostPerToken: 2e-7, outputCostPerToken: 4e-7, metadata: { verifiable: true, attestationSupported: true, providerType: 'vllm', contextLength: 1024 } }] }));
    const result = await createReport({ env: { NEARAI_API_KEY: secret }, fetchImpl });
    expect(result.verifiableModels[0]).toMatchObject({ modelId: '[REDACTED]', inputCostPerToken: '2e-7', outputCostPerToken: '4e-7' });
    expect(JSON.stringify(result)).not.toContain('fixture-');
  });

  it('preserves actual structured USD catalogue prices and excludes unknown monetary fields', async () => {
    const values = [{ amount: 40, scale: 9, currency: 'USD', privateField: 'not-for-output' }, { amount: -1, scale: 9, currency: 'USD' }, { amount: 1, scale: 9, currency: 'unknown' }, { amount: 1, scale: 1000, currency: 'USD' }];
    const models = values.map(inputCostPerToken => ({ modelId: 'fixture-model', inputCostPerToken, metadata: { verifiable: true, attestationSupported: true, providerType: 'vllm' } }));
    const result = await createReport({ fetchImpl: async () => json({ models }) });
    expect(result.verifiableModels.map((m: { inputCostPerToken: unknown }) => m.inputCostPerToken)).toEqual([{ amount: 40, scale: 9, currency: 'USD' }, null, null, null]);
    expect(JSON.stringify(result)).not.toContain('not-for-output');
  });
});

describe('cloud credential configuration', () => {
  it('reads the renamed variable without mutating the inherited environment', () => {
    const inherited = { NEARAI_API_KEY: nearKey };
    const result = resolveEnvironment('PHALA_AI_API_KEY="' + aiKey + '"\nPHALA_CLOUD_API_KEY=\nNEARAI_API_KEY=' + nearKey, inherited);
    expect(result.env).toMatchObject({ PHALA_AI_API_KEY: aiKey, PHALA_CLOUD_API_KEY: '', NEARAI_API_KEY: nearKey });
    expect(result.warnings).toEqual([]);
    expect(inherited).toEqual({ NEARAI_API_KEY: nearKey });
  });

  it('reports inherited overrides, including an empty one, by name only', () => {
    const result = resolveEnvironment('PHALA_AI_API_KEY=' + aiKey + '\nPHALA_CLOUD_API_KEY=' + cloudKey, { PHALA_AI_API_KEY: 'different-fixture-key', PHALA_CLOUD_API_KEY: '' });
    expect(result.env.PHALA_AI_API_KEY).toBe('different-fixture-key');
    expect(result.env.PHALA_CLOUD_API_KEY).toBe('');
    expect(result.warnings).toEqual([
      { status: 'environment-overrides-file', variable: 'PHALA_AI_API_KEY' },
      { status: 'environment-overrides-file', variable: 'PHALA_CLOUD_API_KEY' },
    ]);
    expect(JSON.stringify(result.warnings)).not.toContain(aiKey);
  });

  const profile = { schema_version: 1, current_profile: 'fixture', profiles: { fixture: { token: cloudKey, api_prefix: PHALA_API } } };
  const fileReader = (data: unknown, envText = '') => vi.fn(async (path: string) => path.endsWith('.env') ? envText : JSON.stringify(data));

  it('uses the official CLI profile after login when the Cloud variable is blank', async () => {
    const read = fileReader(profile, 'PHALA_AI_API_KEY=' + aiKey + '\nPHALA_CLOUD_API_KEY=');
    const result = await loadConfiguration({ cwd: 'repo', env: {}, home: 'home', read });
    expect(read).toHaveBeenLastCalledWith(join('home', '.phala-cloud', 'credentials.json'), 'utf8');
    expect(result.env).toMatchObject({ PHALA_AI_API_KEY: aiKey, PHALA_CLOUD_API_KEY: cloudKey });
    expect(result.cloudSource).toBe('cli-profile');
    expect(result.warnings).toEqual([]);
  });

  it('honors explicit Cloud credentials before the profile store', async () => {
    const read = fileReader(profile);
    const result = await loadConfiguration({ env: { PHALA_CLOUD_API_KEY: cloudKey }, read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.cloudSource).toBe('environment');
  });

  it('supports an explicit CLI profile selection and isolated credential directory', async () => {
    const read = fileReader({ ...profile, current_profile: 'other' });
    const result = await loadConfiguration({ env: { PHALA_CLOUD_PROFILE: 'fixture', PHALA_CLOUD_DIR: 'private-cli' }, read });
    expect(read).toHaveBeenLastCalledWith(join('private-cli', 'credentials.json'), 'utf8');
    expect(result.env.PHALA_CLOUD_API_KEY).toBe(cloudKey);
  });

  it('does not forward a profile credential to an unsupported API origin', async () => {
    const read = fileReader({ ...profile, profiles: { fixture: { token: cloudKey, api_prefix: 'https://other.invalid/api/v1' } } });
    const result = await loadConfiguration({ env: {}, read });
    expect(result.env.PHALA_CLOUD_API_KEY).toBeUndefined();
    expect(result.warnings).toEqual([{ status: 'unsupported-cloud-profile-origin' }]);
  });

  it.each([null, {}, { ...profile, current_profile: '__proto__' }])('handles malformed profile files without leaking their content: %j', async data => {
    const result = await loadConfiguration({ env: {}, read: fileReader(data) });
    expect(result.env.PHALA_CLOUD_API_KEY).toBeUndefined();
    expect(result.warnings).toEqual([{ status: 'cloud-profile-unreadable' }]);
  });

  it('distinguishes an absent profile from a profile that cannot be read', async () => {
    for (const code of ['ENOENT', 'EACCES']) {
      const read = vi.fn(async (path: string) => { if (path.endsWith('.env')) return ''; throw Object.assign(new Error(cloudKey), { code }); });
      const result = await loadConfiguration({ env: {}, read });
      expect(result.warnings).toEqual(code === 'ENOENT' ? [] : [{ status: 'cloud-profile-unreadable' }]);
    }
  });
});
