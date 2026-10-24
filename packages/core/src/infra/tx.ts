import type { Db } from './db.ts';

type DrizzleTx = Parameters<Parameters<Db['transaction']>[0]>[0];
declare const txBrand: unique symbol;

/**
 * A Drizzle transaction handle that only `withTx` can produce. Service
 * functions that write take `tx: Tx` first, so the global `db` cannot be
 * passed in its place by mistake.
 */
export type Tx = DrizzleTx & { readonly [txBrand]: true };

export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

/** Opens a unit of work. The caller (API route or job handler) owns it. */
export function withTx<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
  options: { isolationLevel?: IsolationLevel } = {},
): Promise<T> {
  return db.transaction(
    (tx) => fn(tx as Tx),
    options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined,
  );
}
