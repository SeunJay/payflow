import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@payflow/shared';
import { asAdmin, createTestDatabase, type TestDatabase } from '@payflow/test-utils';
import { createDb } from './db.ts';

describe('createDb', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('pings a live Postgres (DW-1)', async () => {
    const handle = createDb({ url: database.url, logger });

    await expect(handle.ping()).resolves.toBeUndefined();

    await handle.close();
  });

  it('connects as the payflow role', async () => {
    const handle = createDb({ url: database.url, logger });

    const result = await handle.pool.query<{ user: string }>('select current_user as user');

    expect(result.rows[0]?.user).toBe('payflow');
    await handle.close();
  });

  it('rejects ping when Postgres is unreachable, without crashing (DW-3)', async () => {
    const handle = createDb({ url: 'postgres://payflow:x@127.0.0.1:1/payflow', logger });

    await expect(handle.ping()).rejects.toThrow();

    await handle.close();
  });

  it('survives a dropped idle connection and reconnects on the next ping (DW-3)', async () => {
    const error = vi.spyOn(logger, 'error');
    const handle = createDb({ url: database.url, logger, max: 1 });
    await handle.ping();
    const pid = (await handle.pool.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;

    // What a Postgres restart looks like to an idle pooled client.
    await asAdmin((client) => client.query('select pg_terminate_backend($1)', [pid]));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.anything(), 'idle postgres client error'));

    await expect(handle.ping()).resolves.toBeUndefined();
    await handle.close();
    error.mockRestore();
  });

  it('honours the pool size it is given', async () => {
    const handle = createDb({ url: database.url, logger, max: 3 });

    expect(handle.pool.options.max).toBe(3);
    await handle.close();
  });

  it('close ends the pool so later queries fail', async () => {
    const handle = createDb({ url: database.url, logger });
    await handle.ping();

    await handle.close();

    await expect(handle.ping()).rejects.toThrow();
  });
});
