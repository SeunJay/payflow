// Helpers shared by the ledger integration tests. Only *.int.test.ts files import this.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Db } from '../../infra/db.ts';
import { withTx, type Tx } from '../../infra/tx.ts';
import { getSystemAccount, openAccount } from './accounts.ts';
import { post } from './post.ts';
import type { LedgerAccount, PostedTransaction } from './types.ts';

/** ₦10,000 in kobo, the AC-11 test deposit. */
export const DEPOSIT = 1_000_000n;

export const openWallet = (db: Db): Promise<LedgerAccount> =>
  withTx(db, (tx) => openAccount(tx, { type: 'liability', currency: 'NGN' }));

/** A test deposit from `test_funding` into a liability account. */
export const depositEntries = (fundingId: string, accountId: string, amount: bigint) => [
  { accountId: fundingId, amount },
  { accountId, amount: -amount },
];

export async function fund(
  db: Db,
  accountId: string,
  amount: bigint = DEPOSIT,
  postingKey = `test_deposit:${randomUUID()}`,
): Promise<PostedTransaction> {
  return withTx(db, async (tx) => {
    const funding = await getSystemAccount(tx, 'test_funding');
    return post(tx, {
      postingKey,
      kind: 'test_deposit',
      description: 'Test deposit',
      entries: depositEntries(funding.id, accountId, amount),
    });
  });
}

/** Moves money between two liability accounts: debit `from` (balance falls), credit `to`. */
export const transferInput = (from: string, to: string, amount: bigint, postingKey = `move:${randomUUID()}`) => ({
  postingKey,
  kind: 'test_deposit' as const,
  description: 'Test move',
  entries: [
    { accountId: from, amount },
    { accountId: to, amount: -amount },
  ],
});

export const transfer = (db: Db, from: string, to: string, amount: bigint, postingKey?: string) =>
  withTx(db, (tx) => post(tx, transferInput(from, to, amount, postingKey)));

export type HeldTx<T> = {
  /** Settles once `work` has run, while the unit of work is still open. */
  readonly worked: Promise<T>;
  /** Lets the unit of work commit and settles when it has. */
  readonly commit: () => Promise<T>;
  /** Rolls the unit of work back instead, releasing its locks, and settles when it has. */
  readonly rollback: () => Promise<void>;
};

/** Runs `work` in a unit of work and keeps it open (locks held) until `commit` or `rollback` is called. */
export function holdOpen<T>(db: Db, work: (tx: Tx) => Promise<T>): HeldTx<T> {
  const gate = Promise.withResolvers<'commit' | 'rollback'>();
  const worked = Promise.withResolvers<T>();
  const committed = withTx(db, async (tx) => {
    const value = await work(tx).catch((err: unknown) => {
      worked.reject(err);
      throw err;
    });
    worked.resolve(value);
    if ((await gate.promise) === 'rollback') throw new Error('held unit of work rolled back');
    return value;
  });
  // Marked handled here; callers still see the rejection when they await.
  committed.catch(() => undefined);
  worked.promise.catch(() => undefined);
  return {
    worked: worked.promise,
    commit: () => {
      gate.resolve('commit');
      return committed;
    },
    rollback: async () => {
      gate.resolve('rollback');
      await committed.catch(() => undefined);
    },
  };
}

/** Waits until at least `count` sessions in this database are blocked on a lock. */
export async function waitForLockWaiters(db: Db, count: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const result = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.waiting ?? 0) >= count) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${String(count)} lock waiters`);
}

/** Runs raw SQL on one connection inside BEGIN ... COMMIT, rolling back if anything throws. */
export async function rawTx(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(client);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The Postgres SQLSTATE of an error, unwrapping Drizzle's query error. */
export function pgCode(err: unknown): string | undefined {
  for (let current = err; current instanceof Error; current = current.cause) {
    if ('code' in current && typeof current.code === 'string') return current.code;
  }
  return undefined;
}

export async function countTransactions(db: Db): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from ledger_transactions`);
  return result.rows[0]?.n ?? 0;
}
