import { waitUntil } from '@vercel/functions';
import { createApplication } from '../src/server/app.js';

// All API routes share one Fluid Compute function and its rehearsal sessions.
const hosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'neslos.vercel.app'];
const allowedOrigins = hosts.filter((host): host is string => Boolean(host)).map(host => new URL(`https://${host}`).origin);
if (process.env.NESLOS_PUBLIC_ORIGIN) allowedOrigins.push(new URL(process.env.NESLOS_PUBLIC_ORIGIN).origin);

export default createApplication({ allowedOrigins, secureCookie: true, backgroundTask: waitUntil });
