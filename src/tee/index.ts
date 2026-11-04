import { z } from 'zod';
import { createTeeIdentity } from '../core/attestation.js';
import { createPrivateApp } from './app.js';
import { loadRuntimeOptions } from './config.js';
import { PrivateRuntime } from './runtime.js';

async function main() {
  const mode = z.enum(['private', 'attestation-only']).parse(process.env.NESLOS_RUNTIME_MODE ?? 'private');
  // Bootstrap only serves challenge-bound evidence. It never loads owner/inference secrets.
  const runtime = mode === 'private' ? await PrivateRuntime.create(await loadRuntimeOptions()) : undefined;
  const identity = runtime?.identity ?? await createTeeIdentity(process.env.NESLOS_DSTACK_SOCKET || '/var/run/dstack.sock');
  const port = Number(process.env.PORT ?? 8443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const server = createPrivateApp(identity, runtime).listen(port, process.env.HOST ?? '0.0.0.0', () => console.log('Neslos runtime started: ' + mode + '. No automatic transaction submission.'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 130_000).unref();
  });
}
main().catch(() => { console.error('Neslos TEE startup rejected. Check deployment settings, approved measurements, socket access and durable journal. No private requests accepted.'); process.exitCode = 1; });
