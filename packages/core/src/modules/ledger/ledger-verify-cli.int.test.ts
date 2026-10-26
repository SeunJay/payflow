// `pnpm --filter @payflow/core ledger:verify` (scripts/ledger-verify.ts) exits with
// runLedgerVerify's code (spec 0003, AC-10). It lives here because the vitest
// integration project only collects tests under src/.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from '../../infra/db.ts';
import { fund, openWallet } from './test-support.ts';

const packageRoot = join(import.meta.dirname, '../../..');

type CliResult = { code: number; lines: Record<string, unknown>[]; stderr: string };

describe('ledger:verify CLI (AC-10)', () => {
  let database: TestDatabase;
  let handle: DbHandle;

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger: createLogger({ name: 'test', level: 'silent' }) });
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  async function runCli(env: Record<string, string>): Promise<CliResult> {
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/ledger-verify.ts'],
        { cwd: packageRoot, env: { PATH: process.env.PATH ?? '', ...env } },
      );
      return { code: 0, lines: parseLines(stdout), stderr };
    } catch (err) {
      const failed = err as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? -1, lines: parseLines(failed.stdout ?? ''), stderr: failed.stderr ?? '' };
    }
  }

  const parseLines = (stdout: string) =>
    stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  it('exits 0 and logs the summary on clean books', async () => {
    const wallet = await openWallet(handle.db);
    await fund(handle.db, wallet.id, 500n);

    const result = await runCli({ DATABASE_URL: database.url, LOG_LEVEL: 'info' });

    expect(result.code).toBe(0);
    expect(result.lines).toEqual([
      expect.objectContaining({ msg: 'ledger verify finished', checked: 2, driftCount: 0, name: 'ledger-verify' }),
    ]);
  });

  it('exits 1 and logs each drifted account with string amounts', async () => {
    const wallet = await openWallet(handle.db);
    await fund(handle.db, wallet.id, 300n);
    await handle.pool.query('update ledger_accounts set balance = balance + 7 where id = $1', [wallet.id]);

    const result = await runCli({ DATABASE_URL: database.url, LOG_LEVEL: 'info' });

    expect(result.code).toBe(1);
    expect(result.lines).toContainEqual(expect.objectContaining({ msg: 'ledger verify finished', driftCount: 1 }));
    expect(result.lines).toContainEqual(
      expect.objectContaining({
        msg: 'ledger drift',
        accountId: wallet.id,
        cached: '307',
        rebuilt: '300',
        lastBalanceAfter: '300',
      }),
    );
  });

  it('refuses to start without a DATABASE_URL', async () => {
    const result = await runCli({});

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Invalid configuration[\s\S]*DATABASE_URL/);
  });
});
