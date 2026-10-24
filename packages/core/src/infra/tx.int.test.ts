import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLogger } from '@payflow/shared';
import { createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb, type DbHandle } from './db.ts';
import { withTx } from './tx.ts';

describe('withTx', () => {
  let database: TestDatabase;
  let handle: DbHandle;

  beforeAll(async () => {
    database = await createTestDatabase();
    handle = createDb({ url: database.url, logger: createLogger({ name: 'test', level: 'silent' }) });
    await handle.db.execute(sql`create table notes (body text not null)`);
  });

  afterAll(async () => {
    await handle.close();
    await database.drop();
  });

  const bodies = async () =>
    (await handle.pool.query<{ body: string }>('select body from notes order by body')).rows.map((r) => r.body);

  it('commits the work and returns the result when fn resolves', async () => {
    const result = await withTx(handle.db, async (tx) => {
      await tx.execute(sql`insert into notes values ('committed')`);
      return 'done';
    });

    expect(result).toBe('done');
    expect(await bodies()).toContain('committed');
  });

  it('rolls back every write and rethrows when fn throws', async () => {
    const failing = withTx(handle.db, async (tx) => {
      await tx.execute(sql`insert into notes values ('rolled back')`);
      throw new Error('ledger does not balance');
    });

    await expect(failing).rejects.toThrow('ledger does not balance');
    expect(await bodies()).not.toContain('rolled back');
  });

  it('uses Postgres default read committed when no level is given', async () => {
    const level = await withTx(handle.db, async (tx) => {
      const rows = await tx.execute<{ transaction_isolation: string }>(sql`show transaction_isolation`);
      return rows.rows[0]?.transaction_isolation;
    });

    expect(level).toBe('read committed');
  });

  it.each(['repeatable read', 'serializable'] as const)(
    'opens the transaction at %s when asked',
    async (isolationLevel) => {
      const level = await withTx(
        handle.db,
        async (tx) => {
          const rows = await tx.execute<{ transaction_isolation: string }>(sql`show transaction_isolation`);
          return rows.rows[0]?.transaction_isolation;
        },
        { isolationLevel },
      );

      expect(level).toBe(isolationLevel);
    },
  );
});
