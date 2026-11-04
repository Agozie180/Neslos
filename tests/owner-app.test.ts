import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwnerApplication } from '../src/owner/app.js';
import { OwnerWorkspace } from '../src/owner/workspace.js';
const token = 'aa'.repeat(32);
let server: Server, base: string, origin: string;
const state = vi.fn(), execute = vi.fn(), submit = vi.fn();
beforeEach(async () => {
  vi.resetAllMocks(); state.mockResolvedValue({ configured: false, vault: 'vault.testnet', jobs: [], plans: [] });
  const workspace = { state, execute, submit } as unknown as OwnerWorkspace;
  server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  origin = base; server.on('request', createOwnerApplication(workspace, { token, origin }).app);
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(base + '/api/owner' + path, { method: body === undefined ? 'GET' : 'POST', headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', ...headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', bytes => chunks.push(Buffer.from(bytes)));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode!, headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
    });
    request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function session() {
  const response = await request('/session', { token });
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, 'x-neslos-csrf': (await response.json()).csrf };
}
describe('local owner HTTP boundary', () => {
  it('requires the startup token and keeps private state inaccessible without a session', async () => {
    expect((await request('/state')).status).toBe(401);
    expect((await request('/session', { token: 'bb'.repeat(32) })).status).toBe(401);
    expect(state).not.toHaveBeenCalled();
    const headers = await session(); expect((await request('/state', undefined, headers)).status).toBe(200);
  });
  it('rejects hostile origins, DNS rebinding hostnames and missing CSRF', async () => {
    const headers = await session();
    expect((await request('/jobs', {}, { ...headers, origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await request('/jobs', {}, { ...headers, host: 'attacker.invalid' })).status).toBe(403);
    expect((await request('/jobs', {}, { ...headers, 'x-neslos-csrf': '' })).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it('serializes owner mutations and passes only the explicit plan approval to submission', async () => {
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    execute.mockImplementationOnce(async () => { started(); await barrier; return { state: 'complete' }; });
    submit.mockResolvedValue({ final: true }); const headers = await session();
    const first = request('/jobs', {}, headers); await entered;
    const second = request('/plans/' + 'cc'.repeat(32) + '/submit', { approvedHash: 'cc'.repeat(32), allowMainnet: false }, headers);
    await new Promise(resolve => setTimeout(resolve, 20)); expect(submit).not.toHaveBeenCalled();
    release(); expect((await first).status).toBe(200); expect((await second).status).toBe(200);
    expect(submit).toHaveBeenCalledWith('cc'.repeat(32), 'cc'.repeat(32), false);
  });
  it('rejects file traversal and a publicly bound owner origin', async () => {
    await expect(new OwnerWorkspace().job('../.env')).rejects.toThrow();
    expect(() => createOwnerApplication(undefined, { origin: 'http://0.0.0.0:8788' })).toThrow('LOOPBACK');
  });
});
