import { describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createLogger } from '@payflow/shared';
import { testUrls } from '@payflow/test-utils';
import { createValkey } from './valkey.ts';

describe('createValkey', () => {
  const logger = createLogger({ name: 'test', level: 'silent' });

  it('pings a live Valkey (DW-1)', async () => {
    const handle = createValkey({ url: testUrls().valkey, logger });

    await expect(handle.ping()).resolves.toBeUndefined();

    await handle.close();
  });

  it('is configured the way BullMQ requires (maxRetriesPerRequest: null)', async () => {
    const handle = createValkey({ url: testUrls().valkey, logger });

    expect(handle.client.options.maxRetriesPerRequest).toBeNull();

    await handle.close();
  });

  it('reconnects on its own after the server drops the connection (DW-3)', async () => {
    const handle = createValkey({ url: testUrls().valkey, logger });
    await handle.ping();
    const id = await handle.client.client('ID');

    // What a Valkey restart looks like to a connected client.
    const admin = new Redis(testUrls().valkey);
    await admin.client('KILL', 'ID', String(id));
    await admin.quit();

    await expect(handle.ping()).resolves.toBeUndefined();
    expect(await handle.client.client('ID')).not.toBe(id);
    await handle.close();
  });

  it('close quits the connection so later commands fail', async () => {
    const handle = createValkey({ url: testUrls().valkey, logger });
    await handle.ping();

    await handle.close();

    await expect(handle.ping()).rejects.toThrow('Connection is closed');
  });
});
