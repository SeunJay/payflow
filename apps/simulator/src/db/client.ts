import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { Logger } from '@payflow/shared';
import * as schema from './schema.ts';

// The simulator is an outside company: it never imports @payflow/core, so it
// keeps its own small pool and client.
export function createSimulatorDb(options: { url: string; logger: Logger }) {
  const pool = new pg.Pool({ connectionString: options.url, max: 5 });
  pool.on('error', (err) => options.logger.error({ err }, 'idle postgres client error'));
  const db = drizzle({ client: pool, schema });
  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => pool.end(),
  };
}
