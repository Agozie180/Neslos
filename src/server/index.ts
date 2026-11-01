import { createApplication } from './app.js';
if (process.env.NESLOS_MODE && process.env.NESLOS_MODE !== 'rehearsal') throw new Error('This is the rehearsal server. Attested execution uses the separately verified TEE service.');
const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
if (process.env.NESLOS_PUBLIC_ORIGIN) origins.push(new URL(process.env.NESLOS_PUBLIC_ORIGIN).origin);
const server = createApplication({ allowedOrigins: origins }).listen(port, host, () => console.log(`Neslos rehearsal API: http://${host}:${port} — simulated funds, no hardware claim.`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
