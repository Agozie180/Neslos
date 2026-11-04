// Credit and resource inspection only. No inference, provisioning or billing mutations.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
async function inspect(url, headers = {}, method = 'GET') {
  try {
    const response = await fetch(url, { method, headers: { accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: await response.json() };
  } catch { return { ok: false, status: 'connection-unavailable' }; }
}
const report = { checkedAt: new Date().toISOString(), inferenceRequests: 0, provisionedInstances: 0 };
if (process.env.PHALA_CLOUD_API_KEY) {
  const headers = { 'X-API-Key': process.env.PHALA_CLOUD_API_KEY, 'X-Phala-Version': '2026-01-21' };
  const result = await inspect('https://cloud-api.phala.com/api/v1/auth/me', headers);
  if (result.ok) {
    const me = result.value;
    report.phala = { authenticated: true, credits: typeof me.credits === 'object' ? me.credits : { balance: me.credits, granted_balance: me.granted_credits, is_post_paid: null } };
    const instances = await inspect('https://cloud-api.phala.com/api/v1/cvms', headers);
    const rows = instances.ok ? (Array.isArray(instances.value) ? instances.value : instances.value.items ?? instances.value.data) : undefined;
    report.phala.instances = Array.isArray(rows) ? rows.map(row => ({ id: row.id ?? row.hosted?.id, name: row.name ?? row.hosted?.name, status: row.status ?? row.hosted?.status, resource: row.resource ?? null })) : { status: instances.status ?? 'unrecognized-response' };
  } else report.phala = { authenticated: false, status: result.status };
} else report.phala = { configured: false };
if (process.env.NEARAI_API_KEY) {
  const result = await inspect('https://cloud-api.near.ai/v1/check_api_key', { authorization: 'Bearer ' + process.env.NEARAI_API_KEY }, 'POST');
  report.nearAi = { authenticated: result.ok && result.value.valid === true, status: result.status ?? 200, balance: 'Exact balance requires the owner dashboard session; the API key validity check confirms sufficient credits only.' };
} else report.nearAi = { configured: false };
const catalog = await inspect('https://cloud-api.near.ai/v1/model/list');
if (catalog.ok) report.verifiableModels = catalog.value.models?.filter(m => m.metadata?.verifiable && m.metadata?.attestationSupported && m.metadata?.providerType === 'vllm').map(m => ({ modelId: m.modelId, inputCostPerToken: m.inputCostPerToken, outputCostPerToken: m.outputCostPerToken, contextLength: m.metadata.contextLength }));
console.log(JSON.stringify(report, null, 2));
