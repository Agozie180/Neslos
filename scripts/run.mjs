import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundled = resolve(root, '.tools/node-v24.22.2-win-x64/node.exe');
const node = process.platform === 'win32' && existsSync(bundled) ? bundled : process.execPath;
const extra = process.argv.slice(3);
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
function run(args) {
  const r = spawnSync(node, [...(existsSync(resolve(root, '.env')) ? ['--env-file=.env'] : []), ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const tests = () => run(['node_modules/vitest/vitest.mjs', 'run', '--reporter=default', '--reporter=json', '--outputFile=artifacts/unit-results.json', ...extra]);
const build = () => { run(['node_modules/typescript/bin/tsc', '--noEmit']); run(['node_modules/vite/bin/vite.js', 'build']); run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json']); };
switch (process.argv[2]) {
  case 'test': tests(); break;
  case 'build': build(); break;
  case 'verify':
    tests(); build();
    const results = JSON.parse(readFileSync(resolve(root, 'artifacts/unit-results.json'), 'utf8'));
    writeFileSync(resolve(root, 'artifacts/app-verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), command: 'npm run verify', success: results.success, passedTests: results.numPassedTests, failedTests: results.numFailedTests, build: 'passed', runtime: node }, null, 2));
    break;
  case 'browser': run(['node_modules/@playwright/test/cli.js', 'test', ...extra]); break;
  case 'research': run(['--import', 'tsx', 'scripts/research.ts', ...extra]); break;
  case 'quote': run(['--import', 'tsx', 'scripts/quote.ts', ...extra]); break;
  case 'attestation': run(['--import', 'tsx', 'scripts/verify-attestation.ts', ...extra]); break;
  case 'tee': run(['--import', 'tsx', 'src/tee/index.ts', ...extra]); break;
  case 'start': run(['dist/server/server/index.js', ...extra]); break;
  default: throw new Error('Unknown Neslos task.');
}
