// The pre-commit main guard from spec 0002 ("Gates"): only the bootstrap root
// commit may land on main; once main has history, commits there are refused.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, initRepo, makeTempDir, pathWith, runScript, type TempDir } from './script-harness.ts';

describe('no-commit-on-main.sh', () => {
  let repo: TempDir;

  beforeEach(() => {
    repo = makeTempDir('main-guard');
    initRepo(repo.path);
  });

  afterEach(() => {
    repo.remove();
  });

  const guard = () => runScript('no-commit-on-main.sh', { cwd: repo.path, env: { PATH: pathWith('/nonexistent') } });

  const commitFile = (name: string) => {
    writeFileSync(join(repo.path, name), name);
    git(repo.path, 'add', name);
    git(repo.path, 'commit', '--quiet', '-m', `chore: add ${name}`);
  };

  it('allows the bootstrap root commit on an empty main', () => {
    expect(guard().status).toBe(0);
  });

  it('refuses a commit on main once main has history, with a branch hint', () => {
    commitFile('root.txt');

    const result = guard();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Commits on main are blocked');
    expect(result.stderr).toContain('git switch -c');
  });

  it('allows commits on a feature branch', () => {
    commitFile('root.txt');
    git(repo.path, 'switch', '--quiet', '-c', 'chore/02-coding-standards-tooling');

    expect(guard().status).toBe(0);
  });

  it('allows commits on a branch whose name only contains main', () => {
    commitFile('root.txt');
    git(repo.path, 'switch', '--quiet', '-c', 'feat/main-menu');

    expect(guard().status).toBe(0);
  });

  it('allows a commit on a detached HEAD (no branch to protect)', () => {
    commitFile('root.txt');
    git(repo.path, 'switch', '--quiet', '--detach');

    expect(guard().status).toBe(0);
  });
});
