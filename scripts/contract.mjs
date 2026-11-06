import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCheck } from './evidence.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const operation = process.argv[2];
if (!['build', 'test', 'unit'].includes(operation)) throw new Error('Use build, test, or unit.');
const started = Date.now();
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const finishCheck = startCheck(root, 'contract-verification.json', 'npm run ' + (operation === 'test' ? 'test:contract' : operation === 'build' ? 'build:contract' : 'test:contract:unit'));
let transcript = '';
function command(program, args, env = {}) {
  const result = spawnSync(program, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true, maxBuffer: 20_000_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  transcript += (result.stdout ?? '') + (result.stderr ?? '');
  if (result.error || result.status !== 0) {
    writeFileSync(resolve(root, 'artifacts/contract-output.log'), transcript);
    finishCheck(false, { stage: args[0] ?? program, exitCode: result.status ?? 1, error: result.error?.message ?? 'Contract command failed; see contract-output.log.' });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}
function shellQuote(s) { return "'" + s.replaceAll("'", "'\\''") + "'"; }
const wslRoot = process.platform === 'win32' ? command('wsl.exe', ['-d', process.env.NESLOS_WSL_DISTRO ?? 'Ubuntu', '--exec', 'wslpath', '-u', root.replaceAll('\\', '/')]) : root;
function cargo(args, near = false) {
  if (process.platform === 'win32') {
    const bundled = wslRoot + '/.tools/cargo-near-x86_64-unknown-linux-gnu/cargo-near';
    const binary = near && existsSync(resolve(root, '.tools/cargo-near-x86_64-unknown-linux-gnu/cargo-near')) ? bundled : 'cargo';
    const call = [binary, ...(near ? ['near'] : []), ...args].map(shellQuote).join(' ');
    command('wsl.exe', ['-d', process.env.NESLOS_WSL_DISTRO ?? 'Ubuntu', '--exec', 'bash', '-lc', 'cd ' + shellQuote(wslRoot) + ' && CARGO_TARGET_DIR="$HOME/.cache/neslos-target" ' + call]);
  } else {
    const local = resolve(root, '.tools/cargo-near-x86_64-unknown-linux-gnu/cargo-near');
    const binary = near && existsSync(local) ? local : 'cargo';
    command(binary, [...(near ? ['near'] : []), ...args], { CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? resolve(homedir(), '.cache/neslos-target') });
  }
}
if (operation !== 'unit') {
  cargo(['build', 'non-reproducible-wasm', '--locked', '--manifest-path', 'contracts/policy-vault/Cargo.toml', '--out-dir', 'artifacts'], true);
  if (operation === 'test') cargo(['build', 'non-reproducible-wasm', '--locked', '--manifest-path', 'contracts/test-token/Cargo.toml', '--out-dir', 'artifacts'], true);
  if (operation === 'test') cargo(['build', 'non-reproducible-wasm', '--locked', '--manifest-path', 'contracts/policy-vault/tests/fixtures/commerce/Cargo.toml', '--out-dir', 'artifacts'], true);
}
if (operation !== 'build') cargo(['test', '--locked', '--manifest-path', 'contracts/policy-vault/Cargo.toml', ...(operation === 'unit' ? ['--lib'] : []), '--', '--nocapture']);
writeFileSync(resolve(root, 'artifacts/contract-output.log'), transcript);
const binary = resolve(root, 'artifacts/policy_vault.wasm');
const evidence = {
  generatedAt: new Date().toISOString(), command: 'npm run ' + (operation === 'test' ? 'test:contract' : operation === 'build' ? 'build:contract' : 'test:contract:unit'),
  success: true, elapsedMs: Date.now() - started, environment: operation === 'test' ? 'local NEAR sandbox; virtual balances only' : operation === 'unit' ? 'host unit tests; no sandbox execution' : 'WASM build; no execution',
  testResults: [...transcript.matchAll(/test result: ok[.] ([0-9]+) passed/g)].map(m => Number(m[1])),
  ...(operation !== 'unit' && existsSync(binary) ? { wasmBytes: readFileSync(binary).length, wasmSha256: createHash('sha256').update(readFileSync(binary)).digest('hex') } : {}),
};
finishCheck(true, evidence);
