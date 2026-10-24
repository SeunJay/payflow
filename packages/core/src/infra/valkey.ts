import { Redis } from 'ioredis';
import type { Logger } from '@payflow/shared';

export type ValkeyHandle = {
  client: Redis;
  ping: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * `maxRetriesPerRequest: null` is what BullMQ requires, and it lets commands
 * wait out a Valkey restart instead of failing. Readiness checks bound the
 * wait with their own timeout.
 */
export function createValkey(options: { url: string; logger: Logger }): ValkeyHandle {
  const client = new Redis(options.url, { maxRetriesPerRequest: null });
  client.on('error', (err) => options.logger.error({ err }, 'valkey connection error'));

  return {
    client,
    ping: async () => {
      await client.ping();
    },
    close: async () => {
      await client.quit();
    },
  };
}
