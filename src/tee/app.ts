import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TeeIdentity } from '../core/attestation.js';
import { envelopeSchema } from '../core/channel.js';
import { hashHex } from '../core/wire.js';
import type { PrivateRuntime } from './runtime.js';

export function createPrivateApp(identity: TeeIdentity, runtime?: PrivateRuntime) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  let windowStart = Date.now(), requests = 0;
  app.use((req, res, next) => {
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (req.path !== '/health' && ++requests > 30) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowStart + 60_000 - Date.now()) / 1000)))); res.status(429).json({ error: 'Request window exhausted.' }); return; }
    next();
  });
  app.use(express.json({ limit: '512kb' }));
  app.get('/health', (_req, res) => res.json({ ready: runtime?.ready ?? false, attestationAvailable: true, service: 'neslos-private-runtime',
    execution: runtime ? runtime.inferenceEnabled ? 'research-prepare-observe-audit' : 'status-observe-audit' : 'attestation-only', custody: 'NEAR policy vault' }));
  app.get('/attestation/:nonce', async (req, res) => res.json(await identity.attest(hashHex.parse(req.params.nonce))));
  app.get('/platform', async (_req, res) => {
    if (!identity.platformInfo) { res.status(503).json({ error: 'Platform information unavailable.' }); return; }
    res.json(await identity.platformInfo());
  });
  app.post('/private', async (req, res) => {
    if (!runtime) { res.status(503).json({ error: 'ATTESTATION_ONLY: private commands are disabled.' }); return; }
    const input = z.object({ nonce: hashHex, envelope: envelopeSchema }).strict().parse(req.body);
    res.json(await runtime.handle(input.nonce, input.envelope));
  });
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(400).json({ error: 'Private request rejected.' }); });
  return app;
}
