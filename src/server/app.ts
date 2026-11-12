import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AuditLog, type AuditLogState } from '../core/audit.js';
import { units } from '../core/amounts.js';
import { IntentsClient } from '../core/intents.js';
import { PolicyLedger, type PolicyLedgerState } from '../core/ledger.js';
import { Orchestrator, type OrchestratorState } from '../core/orchestrator.js';
import { DEFAULT_POLICY, policySchema } from '../core/policy.js';
import { rankMarkets, ResearchService } from '../core/research.js';

const missionSchema = z.object({
  requestId: z.string().uuid(), prompt: z.string().trim().min(5).max(1600),
  amount: z.string().max(39).refine(v => { try { return units(v) > 0n; } catch { return false; } }),
  kind: z.enum(['private-payment', 'allocation-reserve', 'public-lending']),
  counterparty: z.string().min(1).max(100), referenceOnly: z.boolean().optional(),
  attack: z.enum(['overspend', 'counterparty', 'slippage', 'privacy', 'stale-quote']).optional(),
}).strict();
interface Session { id: string; csrf: string; touched: number; ledger: PolicyLedger; audit: AuditLog; orchestrator: Orchestrator; lastQuote: number; writes: Promise<void>; activeWork: number }
export interface SessionState { id: string; csrf: string; touched: number; ledger: PolicyLedgerState; audit: AuditLogState; orchestrator: OrchestratorState; lastQuote: number }
export interface SessionStore { load(id: string): Promise<SessionState | null>; save(id: string, state: SessionState): Promise<void>; delete(id: string): Promise<void> }
export interface ApplicationOptions { research?: ResearchService; pace?: number; allowedOrigins?: string[]; secureCookie?: boolean; backgroundTask?: (work: Promise<void>) => void; sessionStore?: SessionStore }

export function createApplication(options: ApplicationOptions = {}) {
  const app = express();
  const research = options.research ?? new ResearchService();
  const sessions = new Map<string, Session>();
  const origins = new Set(options.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:8787', 'http://localhost:8787']);
  const secure = options.secureCookie ?? process.env.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_req, res) => res.json({ name: 'Neslos', ok: true, mode: 'rehearsal', realFunds: false }));
  app.use(express.json({ limit: '32kb', strict: true }));

  const serialize = (value: Session): SessionState => ({ id: value.id, csrf: value.csrf, touched: value.touched, ledger: value.ledger.exportState(), audit: value.audit.exportState(), orchestrator: value.orchestrator.exportState(), lastQuote: value.lastQuote });
  function persist(value: Session): Promise<void> {
    if (!options.sessionStore) return Promise.resolve();
    const state = serialize(value);
    value.writes = value.writes.catch(() => {}).then(() => options.sessionStore!.save(value.id, state));
    return value.writes;
  }
  function assemble(state: Omit<SessionState, 'ledger' | 'audit' | 'orchestrator'> & { ledger: PolicyLedger; audit: AuditLog; orchestrator?: OrchestratorState }): Session {
    let value!: Session;
    const orchestrator = new Orchestrator(state.ledger, state.audit, research, options.pace ?? 550, options.backgroundTask, state.orchestrator, async () => {
      try { await persist(value); } finally { value.activeWork = Math.max(0, value.activeWork - 1); }
    });
    value = { id: state.id, csrf: state.csrf, touched: state.touched, ledger: state.ledger, audit: state.audit, orchestrator, lastQuote: state.lastQuote, writes: Promise.resolve(), activeWork: 0 };
    return value;
  }
  function restore(state: SessionState): Session {
    return assemble({ ...state, ledger: PolicyLedger.restore(state.ledger), audit: AuditLog.restore(state.audit) });
  }
  async function newSession(res: Response): Promise<Session> {
    for (const [id, value] of sessions) if (Date.now() - value.touched > 2 * 60 * 60 * 1000) sessions.delete(id);
    if (sessions.size >= 64) throw new Error('SESSION_CAPACITY: the demo is busy. Try again later.');
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    const ledger = new PolicyLedger(DEFAULT_POLICY), audit = new AuditLog();
    audit.append('policy.created', 'policy', { policy: ledger.policy, disclosure: 'Session rehearsal. No on-chain policy transaction has been made.' });
    const session = assemble({ id, csrf, ledger, audit, touched: Date.now(), lastQuote: 0 });
    sessions.set(id, session);
    await persist(session);
    res.cookie('neslos_session', id, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 2 * 60 * 60 * 1000 });
    return session;
  }
  app.use('/api', async (req, res, next) => {
    const token = /(?:^|;\s*)neslos_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    let known = token ? sessions.get(token) : undefined;
    if (token && options.sessionStore && (!known || known.activeWork === 0)) {
      const stored = await options.sessionStore.load(token);
      if (stored) { known = restore(stored); sessions.set(token, known); }
    }
    if (known && Date.now() - known.touched > 2 * 60 * 60 * 1000) {
      sessions.delete(known.id); await options.sessionStore?.delete(known.id); known = undefined;
    }
    if (!known && req.path !== '/state') { res.status(401).json({ error: 'SESSION_REQUIRED: reload Neslos to create a rehearsal session.' }); return; }
    const session = known ?? await newSession(res);
    session.touched = Date.now(); res.locals.session = session;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const csrf = req.header('x-neslos-csrf') ?? '';
      const origin = req.header('origin');
      if ((origin && !origins.has(origin)) || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) {
        res.status(403).json({ error: 'ORIGIN_OR_CSRF: this request is not authorized for the session.' }); return;
      }
    }
    next();
  });
  const session = (res: Response) => res.locals.session as Session;
  const snapshot = (s: Session) => ({
    sessionId: s.id.slice(0, 16), csrf: s.csrf, mode: 'rehearsal' as const, policy: s.ledger.policy, budget: s.ledger.snapshot(),
    runs: s.orchestrator.list(), audit: s.audit.export(),
    integrations: {
      marketData: 'Rhea Finance + NEAR discovery via DeFiLlama',
      contractBuilt: existsSync(resolve('artifacts/policy_vault.wasm')),
      tee: 'not-provisioned', inference: 'deterministic-rehearsal',
      confidentialQuotes: process.env.ONECLICK_JWT ? 'configured' : 'token-required',
      chain: 'not-deployed', settlement: 'simulated',
    },
  });
  app.get('/api/state', (_req, res) => res.json(snapshot(session(res))));
  app.post('/api/session/reset', async (_req, res) => {
    const current = session(res); await current.writes; sessions.delete(current.id); await options.sessionStore?.delete(current.id);
    res.json(snapshot(await newSession(res)));
  });
  app.get('/api/markets', async (req, res) => {
    const result = await research.discover({ referenceOnly: req.query.reference === 'true', refresh: req.query.refresh === 'true' });
    res.json({ ...result, ranking: rankMarkets(result.markets, session(res).ledger.policy) });
  });
  app.patch('/api/policy', async (req, res) => {
    const input = z.object({ policy: policySchema, expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    const s = session(res); const policy = s.ledger.update(input.policy, input.expectedVersion);
    s.audit.append('policy.updated', 'policy', { policy, budget: s.ledger.snapshot() });
    await persist(s);
    res.json(snapshot(s));
  });
  app.post('/api/runs', async (req, res) => {
    const input = missionSchema.parse(req.body); const s = session(res);
    const launchesWork = !s.orchestrator.hasRequest(input.requestId);
    if (launchesWork) s.activeWork += 1;
    let run: ReturnType<Orchestrator['start']>;
    try { run = s.orchestrator.start(input); }
    catch (error) { if (launchesWork) s.activeWork = Math.max(0, s.activeWork - 1); throw error; }
    await persist(s);
    res.status(202).json({ run });
  });
  app.get('/api/runs/:id', (req, res) => {
    const run = session(res).orchestrator.get(req.params.id as string);
    if (!run) { res.status(404).json({ error: 'Mission not found in this session.' }); return; }
    res.json(run);
  });
  app.get('/api/audit', (_req, res) => res.json(session(res).audit.export()));
  app.get('/api/audit/:id/open', (req, res) => {
    try { res.json({ value: session(res).audit.open(req.params.id as string), disclosure: 'Decrypted for this rehearsal session. A production owner decrypts within the verified channel.' }); }
    catch { res.status(404).json({ error: 'Receipt not found in this session.' }); }
  });
  app.post('/api/quote-preview', async (_req, res) => {
    const s = session(res);
    if (Date.now() - s.lastQuote < 15_000) { res.status(429).json({ error: 'Wait 15 seconds between quote previews.' }); return; }
    s.lastQuote = Date.now();
    await persist(s);
    if (!process.env.ONECLICK_JWT) { res.status(503).json({ error: 'The confidential 1Click endpoint requires an API token. Set ONECLICK_JWT to enable signed dry quotes.' }); return; }
    const quote = await new IntentsClient().quote({ amount: '150000000', maxSlippageBps: s.ledger.policy.maxSlippageBps, recipient: 'neslos-research.near', refundTo: 'neslos-demo.near', dry: true });
    res.json({ quote, disclosure: 'Mainnet dry quote. No deposit address or transaction.' });
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Endpoint not found.' }); });
  const web = resolve('dist/web');
  if (existsSync(web)) {
    app.use(express.static(web, { index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile(resolve(web, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid input.', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }); return; }
    const message = error instanceof Error ? error.message : 'The request could not be completed.';
    const status = /CONFLICT/.test(message) ? 409 : /SESSION_CAPACITY/.test(message) ? 503 : /limit|Wait for/i.test(message) ? 429 : 500;
    res.status(status).json({ error: status === 500 ? 'The operation could not be completed. No funded execution was attempted.' : message });
  });
  return app;
}
