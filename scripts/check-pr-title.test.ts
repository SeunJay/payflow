// The PR title rule from spec 0002 ("Naming and messages"): the title becomes
// the squash commit on main, so it must be a Conventional Commit header.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir, runScript } from './script-harness.ts';

const check = (title: string) => runScript('check-pr-title.sh', { args: [title] });

describe('check-pr-title.sh', () => {
  it.each([
    'feat(ledger): derive balances from entries',
    'fix(http): map body parser 4xx to problems',
    'chore: coding standards and tooling',
    'chore(deps): bump the npm group across 1 directory with 3 updates',
    'feat(http)!: rename problem code invalid_body',
    'revert(ledger): undo balance cache',
    'ci: pin gitleaks to a release binary',
    'feat(test-utils): add a template database helper',
    'test(transfers): overspend and race suite',
  ])('accepts %j', (title) => {
    expect(check(title).status).toBe(0);
  });

  it.each(['docs', 'refactor', 'perf', 'build'])('accepts the %s type', (type) => {
    expect(check(`${type}: tidy the module`).status).toBe(0);
  });

  it.each([
    ['an unknown type', 'feature: add transfers'],
    ['a capitalised type', 'Feat: add transfers'],
    ['a capitalised subject', 'feat: Add transfers'],
    ['a trailing period', 'feat: add transfers.'],
    ['an uppercase scope', 'feat(Ledger): add entries'],
    ['an empty scope', 'feat(): add entries'],
    ['no space after the colon', 'feat:add transfers'],
    ['no colon at all', 'add transfers'],
    ['a one character subject', 'feat: a'],
    ['the breaking marker before the scope', 'feat!(http): rename code'],
  ])('rejects %s', (_case, title) => {
    const result = check(title);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a Conventional Commit header');
  });

  it('rejects an empty title', () => {
    expect(check('').status).toBe(1);
  });

  it('rejects a missing argument', () => {
    expect(runScript('check-pr-title.sh').status).toBe(1);
  });

  it('accepts a title of exactly 72 characters', () => {
    const title = `feat: ${'a'.repeat(66)}`;
    expect(title).toHaveLength(72);

    expect(check(title).status).toBe(0);
  });

  it('rejects a title of 73 characters and says why', () => {
    const title = `feat(ledger): ${'a'.repeat(59)}`;
    expect(title).toHaveLength(73);

    const result = check(title);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('73 characters; the limit is 72');
  });

  it("lets GitHub's own revert titles through unchanged, whatever their length", () => {
    const title = `Revert "feat(ledger): ${'a'.repeat(80)}"`;

    expect(check(title).status).toBe(0);
  });

  it('treats a title that only mentions Revert as a normal title', () => {
    expect(check('Reverting the ledger change').status).toBe(1);
  });

  it('never runs the title as shell', () => {
    const tmp = makeTempDir('pr-title');
    const marker = join(tmp.path, 'ran');

    check(`feat: $(touch ${marker}) \`touch ${marker}\``);

    expect(existsSync(marker)).toBe(false);
    tmp.remove();
  });
});
