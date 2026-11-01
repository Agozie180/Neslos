import express, { type NextFunction, type Request, type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { teePolicySchema } from '../core/attestation.js';
import { inferencePolicySchema } from '../core/inference.js';
import { envelopeSchema } from '../core/channel.js';
import { hashHex } from '../core/wire.js';
import { PrivateRuntime } from './runtime.js';
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error('Missing required deployment setting: ' + name); return value; }
const [tee, inference] = await Promise.all([readFile(required('NESLOS_TEE_POLICY_FILE'), 'utf8'), readFile(required('NESLOS_INFERENCE_POLICY_FILE'), 'utf8')]);
const network = z.enum(['mainnet', 'testnet']).parse(required('NESLOS_NETWORK'));
const runtime = await PrivateRuntime.create({
  network, vault: required('NESLOS_VAULT_ACCOUNT'), teePolicy: teePolicySchema.parse(JSON.parse(tee)),
  inferencePolicy: inferencePolicySchema.parse(JSON.parse(inference)), ownerToken: required('NESLOS_OWNER_TOKEN'),
  nearAiKey: required('NEARAI_API_KEY'), journalPath: process.env.NESLOS_JOURNAL ?? '/data/neslos-audit.json',
  socket: process.env.NESLOS_DSTACK_SOCKET ?? '/var/run/dstack.sock',
});
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
let windowStart = Date.now(), requests = 0;
app.use((req, res, next) => {
  if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
  if (++requests > 30 && req.path !== '/health') { res.status(429).json({ error: 'Request window exhausted.' }); return; }
  next();
});
app.use(express.json({ limit: '512kb' }));
app.get('/health', (_req, res) => res.json({ ready: true, service: 'neslos-private-runtime', execution: 'prepare-and-observe', custody: 'NEAR policy vault' }));
app.get('/attestation/:nonce', async (req, res) => res.json(await runtime.identity.attest(hashHex.parse(req.params.nonce))));
app.post('/private', async (req, res) => {
  const input = z.object({ nonce: hashHex, envelope: envelopeSchema }).strict().parse(req.body);
  res.json(await runtime.handle(input.nonce, input.envelope));
});
app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(400).json({ error: 'Private request rejected.' }); });
const port = Number(process.env.PORT ?? 8443);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
app.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log('Neslos private runtime ready. HPKE protects request and response payloads; funds require a separate on-chain transaction.'));
