// The pre-commit secret scan from spec 0002 ("Gates"): gitleaks on staged
// changes; a missing gitleaks fails the commit with an install hint, never skips.
import { spawnSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, initRepo, makeTempDir, pathWith, runScript, stubBins, type TempDir } from './script-harness.ts';

const hasGitleaks = spawnSync('gitleaks', ['version']).status === 0;

describe('gitleaks-staged.sh', () => {
  let repo: TempDir;
  let bin: TempDir;

  beforeEach(() => {
    repo = makeTempDir('gitleaks');
    bin = makeTempDir('gitleaks-bin');
  });

  afterEach(() => {
    repo.remove();
    bin.remove();
  });

  it('fails with an install hint when gitleaks is missing', () => {
    const result = runScript('gitleaks-staged.sh', { cwd: repo.path, env: { PATH: bin.path } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gitleaks is not installed');
    expect(result.stderr).toContain('brew install gitleaks');
  });

  it('scans only the staged changes, with the repo config and secrets redacted', () => {
    const bins = stubBins(bin.path, { gitleaks: {} });

    const result = runScript('gitleaks-staged.sh', { cwd: repo.path, env: { PATH: pathWith(bins.dir) } });

    expect(result.status).toBe(0);
    expect(bins.calls()).toEqual(['gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml']);
  });

  it('fails the commit when gitleaks reports a leak', () => {
    const bins = stubBins(bin.path, { gitleaks: { exit: 1 } });

    const result = runScript('gitleaks-staged.sh', { cwd: repo.path, env: { PATH: pathWith(bins.dir) } });

    expect(result.status).toBe(1);
  });

  describe.skipIf(!hasGitleaks)('with the real gitleaks binary and this repo config', () => {
    beforeEach(() => {
      initRepo(repo.path);
      copyFileSync(join(import.meta.dirname, '..', '.gitleaks.toml'), join(repo.path, '.gitleaks.toml'));
    });

    const scan = () => runScript('gitleaks-staged.sh', { cwd: repo.path, env: { PATH: pathWith('/nonexistent') } });

    it('blocks a staged AWS access key', () => {
      // Assembled at runtime so this file itself never holds a key gitleaks would flag
      const key = ['AKIA', 'QX4RZ7VN2P6KTW3M'].join('');
      writeFileSync(join(repo.path, 'settings.ts'), `export const awsKey = '${key}';\n`);
      git(repo.path, 'add', 'settings.ts');

      const result = scan();

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).not.toContain(key);
    });

    it('lets a clean staged change through', () => {
      writeFileSync(join(repo.path, 'sum.ts'), 'export const sum = (a: number, b: number) => a + b;\n');
      git(repo.path, 'add', 'sum.ts');

      expect(scan().status).toBe(0);
    });

    it('allows the development passwords in .env.example', () => {
      copyFileSync(join(import.meta.dirname, '..', '.env.example'), join(repo.path, '.env.example'));
      git(repo.path, 'add', '.env.example');

      expect(scan().status).toBe(0);
    });
  });
});
