// Runs INSIDE the built Linux image. All socket responses are deliberate test fixtures.
// A successful test means the fake quote was REJECTED, never that hardware was verified.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

// Inline bundles supply their exact measured startup command. The image test
// keeps its original entrypoint when this optional fixture path is omitted.
const startupCommand = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : ['node', '/app/dist/server/tee/index.js'];
assert.ok(Array.isArray(startupCommand) && startupCommand[0] === 'node' && startupCommand.every(value => typeof value === 'string'));

const directory = await mkdtemp('/tmp/neslos-tee-smoke-'), socket = directory + '/dstack.sock';
let privateStarted = false, privateQuoteRequests = 0;
const server = createServer(async (request, response) => {
  for await (const _chunk of request) { /* consume test request */ }
  response.setHeader('content-type', 'application/json');
  if (privateStarted && request.url === '/GetQuote') privateQuoteRequests++;
  response.end(JSON.stringify(request.url === '/GetKey' ? { key: '07'.repeat(32), signature_chain: [] } : { quote: '00'.repeat(400), event_log: '[]' }));
});
await new Promise(resolve => server.listen(socket, resolve));
const children = [];
const inferenceBoot = { mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48) };
function start(extra) {
  const child = spawn(process.execPath, startupCommand.slice(1), { cwd: '/app', env: { ...process.env, NESLOS_DSTACK_SOCKET: socket, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); let output = '';
  child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
  const closed = new Promise(resolve => child.on('close', code => resolve({ code, output })));
  return { child, closed };
}
try {
  const bootstrap = start({ NESLOS_RUNTIME_MODE: 'attestation-only', PORT: '18443' });
  let health;
  for (let i = 0; i < 100; i++) {
    try { health = await (await fetch('http://127.0.0.1:18443/health')).json(); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(health?.ready, false); assert.equal(health?.execution, 'attestation-only');
  assert.equal((await fetch('http://127.0.0.1:18443/private', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503);
  const nonce = 'aa'.repeat(32);
  assert.equal((await (await fetch('http://127.0.0.1:18443/attestation/' + nonce)).json()).nonce, nonce);
  bootstrap.child.kill('SIGTERM'); await bootstrap.closed;
  privateStarted = true;
  const privateMode = start({ NESLOS_RUNTIME_MODE: 'private', NESLOS_NETWORK: 'testnet', NESLOS_VAULT_ACCOUNT: 'vault.testnet', NESLOS_OWNER_TOKEN: 'bb'.repeat(32), NEARAI_API_KEY: 'fixture-only',
    NESLOS_TEE_POLICY_JSON: JSON.stringify({ format: 'neslos-tdx-policy-v1', mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48), rtMr3: '55'.repeat(48) }),
    NESLOS_INFERENCE_POLICY_JSON: JSON.stringify({ modelId: 'fixture', gateway: { osImageHash: 'aa'.repeat(32), composeHash: 'bb'.repeat(32), boot: inferenceBoot }, model: { osImageHash: 'cc'.repeat(32), composeHash: 'dd'.repeat(32), boot: inferenceBoot }, modelDeployment: { commit: 'a'.repeat(40), file: 'prod/test.yaml', fileSha256: 'b'.repeat(64), actionsSha256: 'd'.repeat(64), managerImage: `nearaidev/compose-manager@sha256:${'c'.repeat(64)}`, services: ['test-proxy'] } }),
  });
  const failure = await Promise.race([privateMode.closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Private startup did not stop on fake quote')), 20000); timer.unref(); })]);
  assert.equal(failure.code, 1); assert.match(failure.output, /TEE startup rejected/);
  assert.ok(privateQuoteRequests > 0, 'Private startup must reach hardware verification; a policy parsing error is not fake-quote rejection.');
  const beforeOwnerQuote = privateQuoteRequests;
  const ownerOnly = start({ NESLOS_RUNTIME_MODE: 'private', NESLOS_NETWORK: 'testnet', NESLOS_VAULT_ACCOUNT: 'vault.testnet', NESLOS_OWNER_TOKEN: 'bb'.repeat(32),
    NESLOS_INFERENCE_ENABLED: 'false', NEARAI_API_KEY: '', NESLOS_INFERENCE_POLICY_JSON: '',
    NESLOS_TEE_POLICY_JSON: JSON.stringify({ format: 'neslos-tdx-policy-v1', mrTd: '11'.repeat(48), rtMr0: '22'.repeat(48), rtMr1: '33'.repeat(48), rtMr2: '44'.repeat(48), rtMr3: '55'.repeat(48) }),
  });
  const ownerFailure = await Promise.race([ownerOnly.closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Owner-only startup did not stop on fake quote')), 20000); timer.unref(); })]);
  assert.equal(ownerFailure.code, 1); assert.match(ownerFailure.output, /TEE startup rejected/);
  assert.ok(privateQuoteRequests > beforeOwnerQuote, 'Inference-disabled owner commands must still require genuine hardware verification.');
  console.log(JSON.stringify({ containerChecks: 'passed', bootstrapPrivateEndpoint: 503, fakeQuoteRejected: true, ownerOnlyFakeQuoteRejected: true, genuineHardwareVerified: false, uid: process.getuid() }));
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
