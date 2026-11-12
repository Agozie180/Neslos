import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundled = resolve(root, '.tools/node-v24.22.2-win-x64/node.exe');
const node = process.platform === 'win32' && existsSync(bundled) ? bundled : process.execPath;
const playwright = ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)];
const nodeArgs = args => [...(existsSync(resolve(root, '.env')) ? ['--env-file=.env'] : []), ...args];

function run(args, env = process.env) {
  const result = spawnSync(node, nodeArgs(args), { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function start(args) {
  return spawn(node, nodeArgs(args), { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
}

async function ready(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Browser test server exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Browser test server did not become ready: ${url}`);
}

function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else child.kill('SIGTERM');
}

if (process.env.NESLOS_E2E_URL) process.exit(run(playwright));

const api = start(['--import', 'tsx', 'src/server/index.ts']);
const web = start(['node_modules/vite/bin/vite.js']);
let status = 1;
try {
  await Promise.all([ready('http://127.0.0.1:8787/api/health', api), ready('http://127.0.0.1:5173', web)]);
  status = run(playwright, { ...process.env, NESLOS_E2E_URL: 'http://127.0.0.1:5173' });
} finally {
  stop(web);
  stop(api);
}
process.exit(status);
