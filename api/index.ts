import { getCache, waitUntil } from '@vercel/functions';
import { createApplication, type SessionState, type SessionStore } from '../src/server/app.js';

// Rehearsal sessions are cached across Fluid Compute instances; affinity is an
// optimization only and is not treated as durable state.
const hosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'neslos.vercel.app'];
const allowedOrigins = hosts.filter((host): host is string => Boolean(host)).map(host => new URL(`https://${host}`).origin);
if (process.env.NESLOS_PUBLIC_ORIGIN) allowedOrigins.push(new URL(process.env.NESLOS_PUBLIC_ORIGIN).origin);
const cache = getCache({ namespace: 'neslos-rehearsal-v1' });
const sessionStore: SessionStore = {
  async load(id) { return await cache.get(id) as SessionState | null; },
  async save(id, state) { await cache.set(id, state, { ttl: 2 * 60 * 60, name: '' }); },
  async delete(id) { await cache.delete(id); },
};

export default createApplication({ allowedOrigins, secureCookie: true, backgroundTask: waitUntil, sessionStore });
