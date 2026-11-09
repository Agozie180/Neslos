/** Free verification against an already reviewed runtime policy. Never Chat.
 * node --env-file=.env --import tsx scripts/inference-preflight.ts
 *   --policy reviewed-policy.json --out .private/fresh-preflight.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createVerifiedInferenceClient, inferencePolicySchema } from '../src/core/inference.js';
import { canonical, sha256 } from '../src/core/crypto.js';

try {
  const { values } = parseArgs({ options: { policy: { type: 'string' }, out: { type: 'string' } }, strict: true });
  if (!values.policy || !values.out) throw new Error('POLICY_OUTPUT_REQUIRED');
  const policy = inferencePolicySchema.parse(JSON.parse(await readFile(values.policy, 'utf8')));
  const key = process.env.NEARAI_API_KEY;
  if (!key) throw new Error('NEARAI_API_KEY_REQUIRED');
  const verified = await createVerifiedInferenceClient(policy, key).verify(policy.modelId);
  const summary = { checkedAt: new Date().toISOString(), modelId: policy.modelId, transport: 'direct' in policy ? 'direct-e2ee-ohttp-pinned-tls' : 'gateway-e2ee-pinned-tls', policySha256: sha256(canonical(policy)), inferenceCalls: 0, approvedPreflightPassed: true };
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, JSON.stringify({ ...summary, verified }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const code = (error as { failure?: { code?: string } })?.failure?.code;
  console.error(JSON.stringify({ approvedPreflightPassed: false, inferenceCalls: 0, failure: code && /^[a-z0-9_.]+$/.test(code) ? code : 'POLICY_OR_VERIFICATION_FAILED' }));
  process.exitCode = 1;
}
