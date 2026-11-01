import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../src/server/app.js';
import { ResearchService } from '../src/core/research.js';
import type { AppState } from '../src/web/api.js';
import type { MissionRun } from '../src/core/types.js';
let server: Server, base: string;
beforeAll(async () => {
  const app = createApplication({ research: new ResearchService(async () => { throw new Error('Deliberate offline test'); }), pace: 2, allowedOrigins: ['http://neslos.test'], secureCookie: false });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
async function session() {
  const response = await fetch(base + '/api/state');
  const state = await response.json() as AppState;
  return { state, cookie: response.headers.get('set-cookie')!.split(';')[0]! };
}
async function call(s: Awaited<ReturnType<typeof session>>, path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return fetch(base + '/api' + path, { method, headers: { cookie: s.cookie, origin: 'http://neslos.test', 'content-type': 'application/json', 'x-neslos-csrf': s.state.csrf, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const mission = () => ({ requestId: randomUUID(), prompt: 'Research NEAR stablecoin yields.', amount: '150000000', kind: 'allocation-reserve', counterparty: 'treasury-reserve', referenceOnly: true });
async function terminal(s: Awaited<ReturnType<typeof session>>, id: string): Promise<MissionRun> {
  for (let i = 0; i < 100; i++) {
    const r = await (await call(s, '/runs/' + id)).json() as MissionRun;
    if (['settled', 'blocked', 'failed'].includes(r.status)) return r;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Mission did not finish.');
}
describe('session API and complete flow', () => {
  it('isolates browser sessions, policies and receipts', async () => {
    const a = await session(), b = await session();
    expect(a.cookie).not.toBe(b.cookie); expect(a.state.audit.publicKey).not.toBe(b.state.audit.publicKey);
    const changed = await call(a, '/policy', 'PATCH', { policy: { ...a.state.policy, dailyLimit: '900000000' }, expectedVersion: 1 });
    expect(changed.status).toBe(200);
    expect((await (await call(b, '/state')).json()).policy.dailyLimit).toBe('500000000');
    expect((await call(b, '/audit/' + a.state.audit.entries[0]!.id + '/open')).status).toBe(404);
  });
  it('denies a cross-origin or missing-CSRF mutation', async () => {
    const s = await session();
    expect((await call(s, '/runs', 'POST', mission(), { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await call(s, '/runs', 'POST', mission(), { 'x-neslos-csrf': '' })).status).toBe(403);
    expect((await call(s, '/runs', 'POST', mission(), { 'x-neslos-csrf': 'é'.repeat(64) })).status).toBe(403);
  });
  it('runs research → proposal → guardian → execution → settlement → receipt', async () => {
    const s = await session();
    const response = await call(s, '/runs', 'POST', mission());
    expect(response.status).toBe(202);
    const r = await terminal(s, (await response.json()).run.id);
    expect(r.status).toBe('settled');
    expect(r.steps.every(step => step.status === 'complete')).toBe(true);
    expect(r.reports).toHaveLength(4); expect(r.decision?.allowed).toBe(true);
    expect(r.settlement?.transactionHash).toBeNull();
    const state = await (await call(s, '/state')).json() as AppState;
    expect(state.budget.spent).toBe('150000000');
    const receipt = await (await call(s, '/audit/' + r.receiptId + '/open')).json();
    expect(receipt.value.settlement.status).toBe('REHEARSAL_SUCCESS');
  });
  it('shows a denial and consumes no allowance for an attack', async () => {
    const s = await session();
    const response = await call(s, '/runs', 'POST', { ...mission(), attack: 'overspend' });
    const r = await terminal(s, (await response.json()).run.id);
    expect(r.status).toBe('blocked'); expect(r.receiptId).toBeTruthy();
    expect((await (await call(s, '/state')).json()).budget.spent).toBe('0');
  });
  it('rejects changed idempotent requests and stale policy updates', async () => {
    const s = await session(), m = mission();
    await call(s, '/runs', 'POST', m);
    expect((await call(s, '/runs', 'POST', { ...m, amount: '160000000' })).status).toBe(409);
    await call(s, '/policy', 'PATCH', { policy: s.state.policy, expectedVersion: 1 });
    expect((await call(s, '/policy', 'PATCH', { policy: s.state.policy, expectedVersion: 1 })).status).toBe(409);
  });
  it('rejects forged execution modes and invalid monetary payloads', async () => {
    const s = await session();
    expect((await call(s, '/runs', 'POST', { ...mission(), mode: 'attested' })).status).toBe(400);
    expect((await call(s, '/runs', 'POST', { ...mission(), amount: '1e6' })).status).toBe(400);
  });
  it('multiple concurrent missions share a single atomic reservation', async () => {
    const s = await session();
    const responses = await Promise.all(Array.from({ length: 3 }, async () => (await (await call(s, '/runs', 'POST', mission())).json()).run.id as string));
    const runs = await Promise.all(responses.map(id => terminal(s, id)));
    expect(runs.filter(r => r.status === 'settled')).toHaveLength(1);
    expect(runs.filter(r => r.status === 'blocked')).toHaveLength(2);
    expect((await (await call(s, '/state')).json()).budget.spent).toBe('150000000');
  });
});
