// Read-only account diagnostics. Never generates tokens or provisions resources.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export const PHALA_API = 'https://cloud-api.phala.com/api/v1';
const PHALA_VERSION = '2026-06-23';
const credentialNames = ['PHALA_AI_API_KEY', 'PHALA_CLOUD_API_KEY', 'NEARAI_API_KEY'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const decimal = value => (typeof value === 'string' || typeof value === 'number') && Number.isFinite(Number(value)) && /^-?\d{1,30}(\.\d{1,18})?([eE][+-]?\d{1,3})?$/.test(String(value)) ? String(value) : null;
const missing = () => ({ configured: false, authenticated: false, status: 'not-configured' });
function price(value) {
  if (!record(value)) return decimal(value);
  return value.currency === 'USD' && Number.isSafeInteger(value.amount) && value.amount >= 0 && Number.isSafeInteger(value.scale) && value.scale >= 0 && value.scale <= 18
    ? { amount: value.amount, scale: value.scale, currency: 'USD' } : null;
}

export async function inspect(url, headers = {}, method = 'GET', fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { method, headers: { accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch {
    // Transport exceptions and upstream error bodies may contain credentials.
    return { ok: false, status: 'connection-unavailable' };
  }
  const httpStatus = response.status;
  if (!response.ok) return { ok: false, httpStatus, status: httpStatus === 401 ? 'unauthorized' : httpStatus === 403 ? 'permission-denied' : httpStatus === 429 ? 'rate-limited' : 'http-error' };
  try { return { ok: true, httpStatus, value: await response.json() }; }
  catch { return { ok: false, httpStatus, status: 'malformed-response' }; }
}

function account(result, service) {
  const base = { configured: true, authenticated: false, httpStatus: result.httpStatus };
  if (!result.ok) return { ...base, status: result.status };
  const value = result.value;
  if (!record(value) || !record(value.user) || !nonempty(value.user.username) || !record(value.workspace) || !nonempty(value.workspace.slug)) return { ...base, status: 'malformed-response' };
  const credits = record(value.credits) ? value.credits : { balance: value.credits, granted_balance: value.granted_credits };
  const balance = decimal(credits.balance), granted = decimal(credits.granted_balance);
  if (service === 'privateAi' && (balance === null || granted === null)) return { ...base, status: 'malformed-response' };
  return {
    ...base, authenticated: true, status: 'authenticated',
    credits: { balance, grantedBalance: granted, ...(service === 'cloud' ? { isPostPaid: typeof credits.is_post_paid === 'boolean' ? credits.is_post_paid : null } : {}) },
  };
}

// .env never silently defeats an inherited credential. Report the conflict by
// variable name while retaining Node's environment-over-file precedence.
export function resolveEnvironment(fileText, inherited = {}) {
  const file = parseEnv(fileText);
  const env = { ...file, ...inherited };
  const warnings = credentialNames.filter(name => inherited[name] !== undefined && file[name] !== undefined && inherited[name] !== file[name]).map(variable => ({ status: 'environment-overrides-file', variable }));
  return { env, warnings };
}

export async function loadConfiguration({ cwd = process.cwd(), env: inherited = process.env, home = homedir(), read = readFile } = {}) {
  let fileText = '';
  try { fileText = await read(join(cwd, '.env'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read .env for cloud diagnostics.'); }
  const config = resolveEnvironment(fileText, inherited);
  const { env, warnings } = config;
  config.cloudSource = 'environment';
  if (nonempty(env.PHALA_CLOUD_API_KEY)) return config;

  // Same profile store as `phala login`. Only the hosted Phala API is supported;
  // a profile cannot redirect credentials to a different server.
  try {
    const data = JSON.parse(await read(join(env.PHALA_CLOUD_DIR || join(home, '.phala-cloud'), 'credentials.json'), 'utf8'));
    const name = env.PHALA_CLOUD_PROFILE || data.current_profile;
    const profile = record(data.profiles) && Object.hasOwn(data.profiles, name) ? data.profiles[name] : undefined;
    if (data.schema_version !== 1 || !record(profile) || !nonempty(profile.token)) throw new Error('Invalid profile');
    if (profile.api_prefix?.replace(/\/$/, '') !== PHALA_API) {
      warnings.push({ status: 'unsupported-cloud-profile-origin' });
    } else {
      env.PHALA_CLOUD_API_KEY = profile.token;
      config.cloudSource = 'cli-profile';
    }
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push({ status: 'cloud-profile-unreadable' });
  }
  return config;
}

export async function createReport({ env = {}, warnings = [], cloudSource = 'environment', fetchImpl = fetch, now = () => new Date() } = {}) {
  const report = { checkedAt: now().toISOString(), inferenceRequests: 0, provisionedInstances: 0, warnings: [...warnings], phala: {} };
  const cache = new Map();
  function probe(service, key) {
    const id = service + ':' + key;
    if (!cache.has(id)) {
      const headers = service === 'privateAi' ? { authorization: 'Bearer ' + key } : { 'X-API-Key': key, 'X-Phala-Version': PHALA_VERSION };
      cache.set(id, inspect(PHALA_API + (service === 'privateAi' ? '/private_ai/self' : '/auth/me'), headers, 'GET', fetchImpl).then(result => account(result, service)));
    }
    return cache.get(id);
  }
  async function diagnose(service, key) {
    if (!nonempty(key)) return missing();
    const result = await probe(service, key);
    // A 401 for one product cannot establish that the credential is invalid.
    // Confirm its scope at the other product's authenticated account endpoint.
    if (result.status !== 'unauthorized') return result;
    const other = service === 'cloud' ? 'privateAi' : 'cloud';
    const alternate = await probe(other, key);
    if (alternate.authenticated) return {
      ...result, status: 'credential-scope-mismatch', credentialService: other,
      authenticatedForOtherService: true, credits: alternate.credits,
      nextStep: service === 'cloud' ? 'Move this key to PHALA_AI_API_KEY; use phala login or a Cloud API key for CVM management.' : 'Move this key to PHALA_CLOUD_API_KEY; obtain a Private AI API key for PHALA_AI_API_KEY.',
    };
    return { ...result, otherServiceStatus: alternate.status };
  }
  report.phala.privateAi = await diagnose('privateAi', env.PHALA_AI_API_KEY);
  report.phala.cloud = await diagnose('cloud', env.PHALA_CLOUD_API_KEY);
  if (report.phala.cloud.configured) report.phala.cloud.source = cloudSource;
  else report.phala.cloud.nextStep = 'Run phala login --no-open or configure a Cloud-management key in PHALA_CLOUD_API_KEY.';
  if (report.phala.cloud.authenticated) {
    const result = await inspect(PHALA_API + '/cvms', { 'X-API-Key': env.PHALA_CLOUD_API_KEY, 'X-Phala-Version': PHALA_VERSION }, 'GET', fetchImpl);
    const value = result.value;
    const rows = Array.isArray(value) ? value : record(value) ? value.items ?? value.data : undefined;
    // Report only an inventory count. Never emit full resource/account objects,
    // compose contents, user identities, environment variables or credentials.
    report.phala.cloud.instances = !result.ok ? { status: result.status, httpStatus: result.httpStatus }
      : Array.isArray(rows) && rows.every(record) ? { status: 'available', returnedCount: rows.length }
      : { status: 'malformed-response' };
  }
  if (nonempty(env.NEARAI_API_KEY)) {
    const result = await inspect('https://cloud-api.near.ai/v1/check_api_key', { authorization: 'Bearer ' + env.NEARAI_API_KEY }, 'POST', fetchImpl);
    report.nearAi = {
      configured: true, authenticated: result.ok && result.value?.valid === true,
      status: result.ok ? typeof result.value?.valid === 'boolean' ? result.value.valid ? 'authenticated' : 'invalid-or-insufficient-credit' : 'malformed-response' : result.status,
      httpStatus: result.httpStatus,
      balance: 'Exact balance requires the owner dashboard session; this endpoint checks key validity and sufficient credits only.',
    };
  } else report.nearAi = missing();
  const catalog = await inspect('https://cloud-api.near.ai/v1/model/list', {}, 'GET', fetchImpl);
  report.modelCatalog = { authenticatedEndpoint: false, status: catalog.ok ? Array.isArray(catalog.value?.models) ? 'available' : 'malformed-response' : catalog.status };
  if (report.modelCatalog.status === 'available') report.verifiableModels = catalog.value.models
    .filter(m => record(m) && m.metadata?.verifiable === true && m.metadata?.attestationSupported === true && m.metadata?.providerType === 'vllm' && nonempty(m.modelId))
    .map(m => ({ modelId: m.modelId, inputCostPerToken: price(m.inputCostPerToken), outputCostPerToken: price(m.outputCostPerToken), contextLength: Number.isSafeInteger(m.metadata.contextLength) ? m.metadata.contextLength : null }));
  // Defence in depth for any server-controlled strings in an otherwise allowlisted report.
  const secrets = credentialNames.map(name => env[name]).filter(nonempty);
  return JSON.parse(JSON.stringify(report, (_name, value) => {
    if (typeof value !== 'string') return value;
    for (const secret of secrets) value = value.replaceAll(secret, '[REDACTED]');
    return value;
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await createReport(await loadConfiguration()), null, 2)); }
  catch { console.error('Cloud diagnostics could not load configuration. Check local file access and .env syntax. No paid requests were made.'); process.exitCode = 1; }
}
