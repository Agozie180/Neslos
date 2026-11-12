import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApplication, type SessionState, type SessionStore } from '../src/server/app.js';
import type { AppState } from '../src/web/api.js';

const values = new Map<string, SessionState>();
const store: SessionStore = {
  async load(id) { return structuredClone(values.get(id) ?? null); },
  async save(id, state) { values.set(id, structuredClone(state)); },
  async delete(id) { values.delete(id); },
};
const servers: Server[] = [];
const bases: string[] = [];

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const server = createApplication({ pace: 2, allowedOrigins: ['http://neslos.test'], secureCookie: false, sessionStore: store }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    servers.push(server); bases.push('http://127.0.0.1:' + (server.address() as { port: number }).port);
  }
});
afterAll(async () => Promise.all(servers.map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))));

async function state(base: string, cookie?: string) {
  const response = await fetch(base + '/api/state', { headers: cookie ? { cookie } : {} });
  return { value: await response.json() as AppState, cookie: cookie ?? response.headers.get('set-cookie')!.split(';')[0]! };
}
async function start(base: string, session: Awaited<ReturnType<typeof state>>, attack?: 'overspend') {
  const response = await fetch(base + '/api/runs', {
    method: 'POST', headers: { cookie: session.cookie, origin: 'http://neslos.test', 'content-type': 'application/json', 'x-neslos-csrf': session.value.csrf },
    body: JSON.stringify({ requestId: randomUUID(), prompt: 'Research NEAR stablecoin yields.', amount: '150000000', kind: 'allocation-reserve', counterparty: 'treasury-reserve', referenceOnly: true, ...(attack ? { attack } : {}) }),
  });
  expect(response.status).toBe(202);
}
async function waitFor(base: string, cookie: string, status: 'blocked' | 'settled') {
  for (let i = 0; i < 100; i++) {
    const current = await state(base, cookie);
    if (current.value.runs.some(run => run.status === status)) return current;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Persisted session did not reach ${status}.`);
}

describe('shared rehearsal session store', () => {
  it('restores policy, missions, allowance and audit identity across function instances', async () => {
    const original = await state(bases[0]!);
    await start(bases[0]!, original, 'overspend');
    const blocked = await waitFor(bases[1]!, original.cookie, 'blocked');
    expect(blocked.value.sessionId).toBe(original.value.sessionId);
    expect(blocked.value.audit.publicKey).toBe(original.value.audit.publicKey);
    expect(blocked.value.budget.spent).toBe('0');

    await start(bases[1]!, blocked);
    const settled = await waitFor(bases[0]!, original.cookie, 'settled');
    expect(settled.value.runs.map(run => run.status).sort()).toEqual(['blocked', 'settled']);
    expect(settled.value.budget).toMatchObject({ spent: '150000000', remaining: '350000000', reserved: '0' });
    expect(settled.value.audit.entries.length).toBeGreaterThan(original.value.audit.entries.length);
  });
});
