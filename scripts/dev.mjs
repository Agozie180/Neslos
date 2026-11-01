import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundled = resolve(root, '.tools/node-v24.22.2-win-x64/node.exe');
const node = process.platform === 'win32' && existsSync(bundled) ? bundled : process.execPath;
const children = [
  spawn(node, [...(existsSync(resolve(root, '.env')) ? ['--env-file=.env'] : []), '--import', 'tsx', 'src/server/index.ts'], { cwd: root, stdio: 'inherit', windowsHide: true }),
  spawn(node, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit', windowsHide: true }),
];
let closing = false;
function close(code = 0) { if (closing) return; closing = true; for (const child of children) child.kill(); process.exitCode = code; }
for (const child of children) { child.on('error', e => { console.error(e.message); close(1); }); child.on('exit', code => close(code || 0)); }
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
