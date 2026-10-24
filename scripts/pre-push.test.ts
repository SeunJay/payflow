// The pre-push gate from spec 0002 ("Gates"): refuse any push to main, then
// typecheck and run the unit tests unless every pushed ref is a tag or a deletion.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, pathWith, runScript, stubBins, type TempDir } from './script-harness.ts';

const ZERO = '0'.repeat(40);
const ZERO_SHA256 = '0'.repeat(64);
const SHA = 'a1b2c3d4'.repeat(5);

// One stdin line per ref: <local ref> <local sha> <remote ref> <remote sha>
const line = (localRef: string, localSha: string, remoteRef: string, remoteSha = ZERO) =>
  `${localRef} ${localSha} ${remoteRef} ${remoteSha}`;

describe('pre-push.sh', () => {
  let tmp: TempDir;

  beforeEach(() => {
    tmp = makeTempDir('pre-push');
  });

  afterEach(() => {
    tmp.remove();
  });

  const push = (lines: string[], failOn: Record<string, number> = {}) => {
    const bins = stubBins(tmp.path, { pnpm: { failOn } });
    const result = runScript('pre-push.sh', {
      stdin: lines.map((l) => `${l}\n`).join(''),
      env: { PATH: pathWith(bins.dir) },
    });
    return { ...result, calls: bins.calls() };
  };

  it('runs typecheck, then the unit tests, for a feature branch push', () => {
    const result = push([line('refs/heads/feat/05-transfers', SHA, 'refs/heads/feat/05-transfers')]);

    expect(result.status).toBe(0);
    expect(result.calls).toEqual(['pnpm typecheck', 'pnpm test:unit']);
  });

  it('refuses a push to main without running any checks', () => {
    const result = push([line('refs/heads/main', SHA, 'refs/heads/main')]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Pushing to main is blocked');
    expect(result.calls).toEqual([]);
  });

  it('refuses HEAD:main from a feature branch', () => {
    const result = push([line('HEAD', SHA, 'refs/heads/main')]);

    expect(result.status).toBe(1);
  });

  it('refuses a multi ref push when any one ref targets main', () => {
    const result = push([
      line('refs/heads/feat/05-transfers', SHA, 'refs/heads/feat/05-transfers'),
      line('refs/heads/feat/05-transfers', SHA, 'refs/heads/main'),
    ]);

    expect(result.status).toBe(1);
    expect(result.calls).toEqual([]);
  });

  it('refuses deleting main too', () => {
    const result = push([line('(delete)', ZERO, 'refs/heads/main', SHA)]);

    expect(result.status).toBe(1);
  });

  it('does not mistake a branch merely named like main for main', () => {
    const result = push([line('refs/heads/feat/main-menu', SHA, 'refs/heads/feat/main-menu')]);

    expect(result.status).toBe(0);
    expect(result.calls).toEqual(['pnpm typecheck', 'pnpm test:unit']);
  });

  it('skips the checks for a tag only push', () => {
    const result = push([line('refs/tags/slice-02', SHA, 'refs/tags/slice-02')]);

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('skips the checks for a branch deletion', () => {
    const result = push([line('(delete)', ZERO, 'refs/heads/feat/old', SHA)]);

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('treats a SHA-256 all zero sha as a deletion too', () => {
    const result = push([line('(delete)', ZERO_SHA256, 'refs/heads/feat/old', SHA)]);

    expect(result.calls).toEqual([]);
  });

  it('runs the checks once when a tag and a branch are pushed together', () => {
    const result = push([
      line('refs/tags/slice-02', SHA, 'refs/tags/slice-02'),
      line('refs/heads/feat/05-transfers', SHA, 'refs/heads/feat/05-transfers'),
    ]);

    expect(result.calls).toEqual(['pnpm typecheck', 'pnpm test:unit']);
  });

  it('does nothing when git sends no refs', () => {
    const result = push([]);

    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('fails the push and skips the unit tests when typecheck fails', () => {
    const result = push([line('refs/heads/feat/05-transfers', SHA, 'refs/heads/feat/05-transfers')], { typecheck: 2 });

    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual(['pnpm typecheck']);
  });

  it('fails the push when the unit tests fail', () => {
    const result = push([line('refs/heads/feat/05-transfers', SHA, 'refs/heads/feat/05-transfers')], {
      'test:unit': 1,
    });

    expect(result.status).not.toBe(0);
  });
});
