import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppState } from '../src/web/api.js';

const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn<(work: Promise<void>) => void>() }));
vi.mock('@vercel/functions', () => ({ waitUntil }));
let server: Server, base: string;
beforeAll(async () => {
  vi.stubEnv('VERCEL_URL', 'neslos-preview.example');
  vi.stubEnv('VERCEL_BRANCH_URL', 'neslos-branch.example');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'neslos.vercel.app');
  vi.stubEnv('NESLOS_PUBLIC_ORIGIN', 'https://demo.neslos.example');
  const { default: app } = await import('../api/index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
afterAll(async () => {
  await Promise.all(waitUntil.mock.calls.map(([work]) => work));
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function session() {
  const response = await fetch(base + '/api/state');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  return { state: await response.json() as AppState, cookie: response.headers.get('set-cookie')!.split(';')[0]! };
}
const mission = () => ({ requestId: randomUUID(), prompt: 'Research NEAR stablecoin yields.', amount: '150000000', kind: 'allocation-reserve', counterparty: 'treasury-reserve', referenceOnly: true });

describe('Vercel rehearsal API', () => {
  it('serves health and keeps a mission alive through settlement after responding', async () => {
    expect(await (await fetch(base + '/api/health')).json()).toMatchObject({ ok: true, mode: 'rehearsal', realFunds: false });
    const s = await session();
    const response = await fetch(base + '/api/runs', { method: 'POST', headers: { cookie: s.cookie, origin: 'https://neslos.vercel.app', 'content-type': 'application/json', 'x-neslos-csrf': s.state.csrf }, body: JSON.stringify(mission()) });
    expect(response.status).toBe(202);
    const { run } = await response.json();
    expect(run.status).toBe('researching');
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    const state = await (await fetch(base + '/api/state', { headers: { cookie: s.cookie } })).json() as AppState;
    expect(state.sessionId).toBe(s.state.sessionId);
    expect(state.runs[0]).toMatchObject({ id: run.id, status: 'settled' });
    expect(state.budget.spent).toBe('150000000');
    expect(state.audit.entries.length).toBeGreaterThan(s.state.audit.entries.length);
  });

  it('accepts configured deployment origins while rejecting foreign origins and absent CSRF', async () => {
    const s = await session();
    for (const origin of ['https://neslos-preview.example', 'https://neslos-branch.example', 'https://demo.neslos.example', 'https://attacker.example']) {
      const response = await fetch(base + '/api/policy', { method: 'PATCH', headers: { cookie: s.cookie, origin, 'content-type': 'application/json', 'x-neslos-csrf': s.state.csrf }, body: JSON.stringify({ policy: s.state.policy, expectedVersion: s.state.policy.version }) });
      expect(response.status).toBe(origin.includes('attacker') ? 403 : 200);
      if (response.ok) s.state = await response.json() as AppState;
    }
    expect((await fetch(base + '/api/runs', { method: 'POST', headers: { cookie: s.cookie, origin: 'https://neslos.vercel.app', 'content-type': 'application/json' }, body: JSON.stringify(mission()) })).status).toBe(403);
  });
});
