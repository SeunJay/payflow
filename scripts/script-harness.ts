// Test helpers for the shell scripts in this folder: run a script with /bin/sh,
// put stub binaries on PATH, and make throwaway git repos.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Absolute path of a script in this folder. */
export const scriptPath = (name: string) => join(import.meta.dirname, name);

export type ScriptResult = { status: number | null; stdout: string; stderr: string };

/**
 * Runs a script with /bin/sh. The environment is the given one only (plus a
 * neutral git config), so the caller's CI variable or git hooks never leak in.
 */
export function runScript(
  name: string,
  options: { args?: string[]; stdin?: string; cwd?: string; env?: Record<string, string> } = {},
): ScriptResult {
  const result = spawnSync('/bin/sh', [scriptPath(name), ...(options.args ?? [])], {
    cwd: options.cwd,
    input: options.stdin ?? '',
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...options.env },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export type TempDir = { path: string; remove: () => void };

/** A fresh directory under the OS temp folder. Call `remove` in `afterEach`. */
export function makeTempDir(prefix: string): TempDir {
  const path = mkdtempSync(join(tmpdir(), `payflow-${prefix}-`));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

export type StubBin = { dir: string; calls: () => string[] };

/**
 * Writes stub executables into `dir`. Each records its name and arguments to a
 * log, then exits with the given code (0 by default). `failOn` maps a first
 * argument to an exit code, e.g. `{ typecheck: 1 }` for a failing `pnpm typecheck`.
 */
export function stubBins(
  dir: string,
  stubs: Record<string, { exit?: number; failOn?: Record<string, number> }>,
): StubBin {
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  for (const [name, { exit = 0, failOn = {} }] of Object.entries(stubs)) {
    const cases = Object.entries(failOn)
      .map(([arg, code]) => `  ${arg}) exit ${code} ;;\n`)
      .join('');
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${log}"\ncase "$1" in\n${cases}esac\nexit ${exit}\n`);
    chmodSync(file, 0o755);
  }
  return {
    dir,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

/** The usual system PATH, after any stub directory. */
export const pathWith = (dir: string) => `${dir}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin`;

/** Runs git in `cwd` with a neutral config; throws on failure. */
export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A new git repo on `main` with no commits yet. */
export function initRepo(path: string): void {
  git(path, 'init', '--quiet', '--initial-branch=main');
}
