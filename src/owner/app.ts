import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { hashHex } from '../core/wire.js';
import { OwnerWorkspace } from './workspace.js';

export function createOwnerApplication(workspace = new OwnerWorkspace(), options: { token?: string; origin?: string } = {}) {
  const token = options.token ?? randomBytes(32).toString('hex'), origin = options.origin ?? 'http://127.0.0.1:8788';
  hashHex.parse(token);
  const expected = new URL(origin);
  if (expected.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(expected.hostname)) throw new Error('OWNER_LOOPBACK_REQUIRED');
  const app = express(), sessions = new Map<string, { csrf: string; expiresAt: number }>();
  let queue: Promise<unknown> = Promise.resolve();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.get('host') !== expected.host || (req.get('origin') && req.get('origin') !== origin) || (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')!))) { res.status(403).json({ error: 'OWNER_ORIGIN_REQUIRED' }); return; }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.post('/api/owner/session', (req, res) => {
    const supplied = z.object({ token: hashHex }).strict().parse(req.body).token;
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { res.status(401).json({ error: 'OWNER_SESSION_REQUIRED' }); return; }
    for (const [id, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(id);
    if (sessions.size >= 8) { res.status(429).json({ error: 'OWNER_SESSION_LIMIT' }); return; }
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    sessions.set(id, { csrf, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
    res.cookie('neslos_owner', id, { httpOnly: true, sameSite: 'strict', path: '/api/owner', maxAge: 2 * 60 * 60 * 1000 }); res.json({ csrf });
  });
  app.use('/api/owner', (req, res, next) => {
    const id = /(?:^|;\s*)neslos_owner=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expiresAt <= Date.now()) { res.status(401).json({ error: 'OWNER_SESSION_REQUIRED: open the owner link printed by npm run owner.' }); return; }
    res.locals.csrf = session.csrf;
    if (req.method !== 'GET' && req.get('x-neslos-csrf') !== session.csrf) { res.status(403).json({ error: 'OWNER_CSRF_REQUIRED' }); return; }
    next();
  });
  const serial = (work: () => Promise<unknown>) => { const result = queue.then(work); queue = result.catch(() => undefined); return result; };
  app.get('/api/owner/state', async (_req, res) => res.json({ ...await workspace.state(), csrf: res.locals.csrf }));
  app.post('/api/owner/attest', async (_req, res) => res.json(await serial(() => workspace.attest())));
  app.post('/api/owner/runtime-status', async (_req, res) => res.json(await serial(() => workspace.status())));
  app.post('/api/owner/jobs', async (req, res) => res.json(await serial(() => workspace.execute(req.body))));
  app.post('/api/owner/schedules', async (req, res) => res.json(await serial(() => workspace.schedule(req.body))));
  app.post('/api/owner/schedules/:id', async (req, res) => {
    const { state } = z.object({ state: z.enum(['active', 'paused']) }).strict().parse(req.body);
    res.json(await serial(() => workspace.schedules.control(String(req.params.id), state)));
  });
  app.get('/api/owner/jobs/:id', async (req, res) => res.json(await workspace.job(String(req.params.id))));
  app.post('/api/owner/jobs/:id/retry', async (req, res) => res.json(await serial(() => workspace.retry(String(req.params.id)))));
  app.post('/api/owner/jobs/:id/observe', async (req, res) => res.json(await serial(() => workspace.observe(String(req.params.id)))));
  app.post('/api/owner/jobs/:id/plan', async (req, res) => res.json(await serial(() => workspace.createPlan(undefined, String(req.params.id)))));
  app.post('/api/owner/plans', async (req, res) => res.json(await serial(() => workspace.createPlan(req.body))));
  app.post('/api/owner/policy-plan', async (req, res) => res.json(await serial(() => workspace.policyPlan(req.body))));
  app.get('/api/owner/plans/:hash', async (req, res) => res.json(await workspace.plan(String(req.params.hash))));
  app.post('/api/owner/plans/:hash/submit', async (req, res) => {
    const input = z.object({ approvedHash: hashHex, allowMainnet: z.boolean().default(false) }).strict().parse(req.body);
    res.json(await serial(() => workspace.submit(String(req.params.hash), input.approvedHash, input.allowMainnet)));
  });
  app.post('/api/owner/audit', async (_req, res) => res.json(await serial(() => workspace.audit())));
  app.post('/api/owner/audit/:id/open', async (req, res) => res.json(await serial(() => workspace.openReceipt(String(req.params.id)))));
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'OWNER_ENDPOINT_NOT_FOUND' }); });
  const web = resolve('dist/web');
  if (existsSync(web)) { app.use(express.static(web, { index: false })); app.get('/owner', (_req, res) => res.sendFile(resolve(web, 'index.html'))); }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : '';
    const code = /^[A-Z][A-Z0-9_]+/.exec(message)?.[0];
    res.status(error instanceof z.ZodError ? 400 : code ? 409 : 500).json({ error: code ?? 'OWNER_OPERATION_FAILED', detail: error instanceof z.ZodError ? 'Check the input or local owner configuration.' : 'Inspect the saved job or plan before retrying. No replacement payment is sent automatically.' });
  });
  return { app, token, origin, tick: () => serial(() => workspace.schedules.tick()) };
}
