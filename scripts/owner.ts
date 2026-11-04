import { createOwnerApplication } from '../src/owner/app.js';
const port = Number(process.env.NESLOS_OWNER_PORT ?? 8788);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid NESLOS_OWNER_PORT.');
const { app, token, origin, tick } = createOwnerApplication(undefined, { origin: 'http://127.0.0.1:' + port });
const server = app.listen(port, '127.0.0.1', () => console.log('Local owner workspace: ' + origin + '/owner#token=' + token));
let ticking = false;
const timer = setInterval(() => {
  if (ticking) return;
  ticking = true; void tick().catch(() => console.error('SCHEDULE_STORAGE_UNAVAILABLE: inspect local schedule files.')).finally(() => { ticking = false; });
}, 60_000);
timer.unref();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { clearInterval(timer); server.close(() => process.exit(0)); });
