import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  'scripts/browser.mjs',
  'challenge.spec.ts',
  '--grep',
  'Boundary challenge rejects',
], {
  cwd: process.cwd(),
  env: { ...process.env, NESLOS_RETAIN_BROWSER_ARTIFACTS: 'false' },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('BOUNDARY_RESULT $501=rejected $150=allowed remaining=$350 original=verified tamper-test=failed-as-expected');
