import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'linux')('removes deleted Linux source while preserving private state and refreshes same-size edits', () => {
  const base = mkdtempSync(join(tmpdir(), 'neslos-ubuntu-sync-')), source = join(base, 'source'), work = join(base, 'work');
  try {
    for (const dir of ['src', 'scripts', 'tests', 'fixtures', 'deploy/tee']) mkdirSync(join(source, dir), { recursive: true });
    for (const file of ['scripts/ubuntu.sh', 'scripts/evidence.mjs', '.node-version']) copyFileSync(resolve(file), join(source, file));
    const pkg = { name: 'neslos-sync-fixture', version: '1.0.0', scripts: { probe: 'node -e "process.exit(0)"' } };
    writeFileSync(join(source, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(source, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version } } }));
    writeFileSync(join(source, 'src/removed.ts'), 'removed');
    writeFileSync(join(source, 'src/edited.ts'), 'before');
    const run = () => spawnSync('bash', [join(source, 'scripts/ubuntu.sh'), 'probe'], { cwd: source, env: { ...process.env, NESLOS_UBUNTU_WORKDIR: work, npm_config_audit: 'false', npm_config_fund: 'false' }, encoding: 'utf8', timeout: 20000 });
    const first = run(); expect(first.status, first.stderr).toBe(0);
    mkdirSync(join(work, '.private'), { recursive: true });
    writeFileSync(join(work, '.private/journal.json'), 'retain-journal');
    writeFileSync(join(work, '.env'), 'RETAIN=local-settings');
    unlinkSync(join(source, 'src/removed.ts'));
    writeFileSync(join(source, 'src/edited.ts'), 'after!');
    // Match timestamps too: size/mtime shortcuts would retain the wrong bytes.
    const { status } = spawnSync('touch', ['-r', join(work, 'src/edited.ts'), join(source, 'src/edited.ts')]);
    expect(status).toBe(0);
    const second = run(); expect(second.status, second.stderr).toBe(0);
    expect(existsSync(join(work, 'src/removed.ts'))).toBe(false);
    expect(readFileSync(join(work, 'src/edited.ts'), 'utf8')).toBe('after!');
    expect(readFileSync(join(work, '.private/journal.json'), 'utf8')).toBe('retain-journal');
    expect(readFileSync(join(work, '.env'), 'utf8')).toBe('RETAIN=local-settings');
  } finally { rmSync(base, { recursive: true, force: true }); }
}, 45000);
