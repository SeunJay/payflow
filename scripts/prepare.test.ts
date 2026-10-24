// The `prepare` script from spec 0002 ("Enforcement"): `pnpm install` installs
// the Lefthook hooks, skipping only in CI or outside a git checkout; anywhere
// else a failure stops the install.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, pathWith, runScript, stubBins, type TempDir } from './script-harness.ts';

describe('prepare.sh', () => {
  let project: TempDir;
  let bin: TempDir;

  beforeEach(() => {
    project = makeTempDir('prepare');
    bin = makeTempDir('prepare-bin');
  });

  afterEach(() => {
    project.remove();
    bin.remove();
  });

  const prepare = (env: Record<string, string> = {}, lefthookExit = 0) => {
    const bins = stubBins(bin.path, { lefthook: { exit: lefthookExit } });
    const result = runScript('prepare.sh', { cwd: project.path, env: { PATH: pathWith(bins.dir), ...env } });
    return { ...result, calls: bins.calls() };
  };

  it('installs the hooks in a git checkout', () => {
    mkdirSync(join(project.path, '.git'));

    const result = prepare();

    expect(result.status).toBe(0);
    expect(result.calls).toEqual(['lefthook install']);
  });

  it('installs the hooks in a worktree, where .git is a file', () => {
    writeFileSync(join(project.path, '.git'), 'gitdir: /somewhere/else\n');

    expect(prepare().calls).toEqual(['lefthook install']);
  });

  it('skips in CI', () => {
    mkdirSync(join(project.path, '.git'));

    const result = prepare({ CI: 'true' });

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('does not treat an empty CI variable as CI', () => {
    mkdirSync(join(project.path, '.git'));

    expect(prepare({ CI: '' }).calls).toEqual(['lefthook install']);
  });

  it('skips outside a git checkout (an unpacked tarball)', () => {
    const result = prepare();

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('fails the install when lefthook fails', () => {
    mkdirSync(join(project.path, '.git'));

    expect(prepare({}, 1).status).not.toBe(0);
  });
});
