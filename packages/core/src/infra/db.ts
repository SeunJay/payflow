import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Logger } from '@payflow/shared';
import { schema } from '../schema.ts';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

export type DbHandle = {
  db: Db;
  pool: pg.Pool;
  ping: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * One pool per process. The `error` handler keeps an idle client's dropped
 * connection (Postgres restart during a drill) from crashing the process; the
 * pool reconnects on the next checkout.
 */
export function createDb(options: { url: string; logger: Logger; max?: number }): DbHandle {
  const pool = new pg.Pool({ connectionString: options.url, max: options.max ?? 10 });
  pool.on('error', (err) => options.logger.error({ err }, 'idle postgres client error'));

  const db = drizzle({ client: pool, schema });
  return {
    db,
    pool,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => pool.end(),
  };
}
