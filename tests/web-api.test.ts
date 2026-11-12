// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/web/api.js';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('browser API transport', () => {
  it('pins every request in one browser tab to the same Vercel function affinity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);

    await request('/state');
    await request('/markets');

    const first = fetcher.mock.calls[0]![1]!.headers as Record<string, string>;
    const second = fetcher.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(first['X-Vercel-Affinity-Id']).toMatch(/^neslos-browser-[0-9a-f-]{36}$/);
    expect(second['X-Vercel-Affinity-Id']).toBe(first['X-Vercel-Affinity-Id']);
  });
});
