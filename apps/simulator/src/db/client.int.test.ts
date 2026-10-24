import { describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLogger } from '@payflow/shared';
import { asAdmin, testUrls } from '@payflow/test-utils';
import { createSimulatorDb } from './client.ts';

describe('createSimulatorDb', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });

  it('pings its own simulator database as the simulator role (DW-1)', async () => {
    const handle = createSimulatorDb({ url: testUrls().simulator, logger });

    await expect(handle.ping()).resolves.toBeUndefined();

    await handle.close();
  });

  it('rejects ping when Postgres is unreachable, without crashing (DW-3)', async () => {
    const handle = createSimulatorDb({ url: 'postgres://simulator:x@127.0.0.1:1/simulator', logger });

    await expect(handle.ping()).rejects.toThrow();

    await handle.close();
  });

  it('survives a dropped idle connection and reconnects on the next ping (DW-3)', async () => {
    const error = vi.spyOn(logger, 'error');
    const handle = createSimulatorDb({ url: testUrls().simulator, logger });
    const result = await handle.db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    const pid = result.rows[0]!.pid;

    // What a Postgres restart looks like to an idle pooled client.
    await asAdmin((client) => client.query('select pg_terminate_backend($1)', [pid]));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.anything(), 'idle postgres client error'));

    await expect(handle.ping()).resolves.toBeUndefined();
    await handle.close();
    error.mockRestore();
  });

  it('close ends the pool so later pings fail', async () => {
    const handle = createSimulatorDb({ url: testUrls().simulator, logger });
    await handle.ping();

    await handle.close();

    await expect(handle.ping()).rejects.toThrow();
  });
});
