// Rebuilds balances from entries alone and reports drift (spec 0003, AC-10).
import { sql, type SQL } from 'drizzle-orm';
import type { Logger } from '@payflow/shared';
import type { Db } from '../../infra/db.ts';
import type { Tx } from '../../infra/tx.ts';
import { accountIdSchema, parse } from './input.ts';
import type { AccountCheck } from './types.ts';

type CheckRow = {
  account_id: string;
  cached: string;
  rebuilt: string;
  last_balance_after: string | null;
};

// One statement, so every account is read in one consistent snapshot. Sums are
// numeric in Postgres, so they come back as text and are parsed to bigint.
async function checkAccounts(db: Db | Tx, filter: SQL): Promise<AccountCheck[]> {
  const result = await db.execute<CheckRow>(sql`
    select a.id as account_id,
           a.balance::text as cached,
           ((case when a.type in ('asset', 'expense') then 1 else -1 end) * coalesce(sum(e.amount), 0))::text as rebuilt,
           (select le.balance_after::text
              from ledger_entries le
             where le.account_id = a.id and le.seq = a.last_seq) as last_balance_after
      from ledger_accounts a
      left join ledger_entries e on e.account_id = a.id
     ${filter}
     group by a.id
     order by a.id`);

  return result.rows.map((row) => {
    const cached = BigInt(row.cached);
    const rebuilt = BigInt(row.rebuilt);
    const lastBalanceAfter = row.last_balance_after === null ? null : BigInt(row.last_balance_after);
    const ok = cached === rebuilt && (lastBalanceAfter === null ? rebuilt === 0n : lastBalanceAfter === rebuilt);
    return { accountId: row.account_id, cached, rebuilt, lastBalanceAfter, ok };
  });
}

export async function verifyAccount(db: Db | Tx, accountId: string): Promise<AccountCheck> {
  const id = parse(accountIdSchema, accountId);
  const [check] = await checkAccounts(db, sql`where a.id = ${id}`);
  if (!check) throw new Error(`ledger: unknown account ${id}`);
  return check;
}

export async function verifyLedger(db: Db | Tx): Promise<{ checked: number; drift: readonly AccountCheck[] }> {
  const checks = await checkAccounts(db, sql``);
  return { checked: checks.length, drift: checks.filter((check) => !check.ok) };
}

export async function runLedgerVerify(db: Db, logger: Logger): Promise<0 | 1> {
  const { checked, drift } = await verifyLedger(db);
  logger.info({ checked, driftCount: drift.length }, 'ledger verify finished');
  for (const check of drift) {
    logger.error(
      {
        accountId: check.accountId,
        cached: check.cached.toString(),
        rebuilt: check.rebuilt.toString(),
        lastBalanceAfter: check.lastBalanceAfter?.toString() ?? null,
      },
      'ledger drift',
    );
  }
  return drift.length > 0 ? 1 : 0;
}
