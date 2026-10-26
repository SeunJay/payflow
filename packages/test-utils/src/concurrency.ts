// Helpers for deterministic concurrency tests: hold a unit of work open with
// its locks, and wait until another one is provably blocked behind it.
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';

export type HeldTx<T> = {
  /** Settles once `work` has run, while the unit of work is still open. */
  readonly worked: Promise<T>;
  /** Lets the unit of work commit and settles when it has. */
  readonly commit: () => Promise<T>;
  /** Rolls the unit of work back instead, releasing its locks, and settles when it has. */
  readonly rollback: () => Promise<void>;
};

/**
 * Runs `work` inside `transaction` (for example `(fn) => withTx(db, fn)`) and
 * keeps it open, locks held, until `commit` or `rollback` is called.
 */
export function holdOpen<Tx, T>(
  transaction: (fn: (tx: Tx) => Promise<T>) => Promise<T>,
  work: (tx: Tx) => Promise<T>,
): HeldTx<T> {
  const gate = Promise.withResolvers<'commit' | 'rollback'>();
  const worked = Promise.withResolvers<T>();
  const committed = transaction(async (tx) => {
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

/** Waits until at least `count` sessions in the client's database are blocked on a lock. */
export async function waitForLockWaiters(client: pg.Pool | pg.PoolClient | pg.Client, count: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const result = await client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.waiting ?? 0) >= count) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${String(count)} lock waiters`);
}
