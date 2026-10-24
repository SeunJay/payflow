import { createDb, createValkey } from '@payflow/core';
import { createLogger, onShutdown } from '@payflow/shared';
import { config } from './config.ts';
import { startHealthServer } from './health.ts';
import { startRelayLoop } from './relay.ts';

const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL });
const db = createDb({ url: config.DATABASE_URL, logger });
const valkey = createValkey({ url: config.VALKEY_URL, logger });

const relay = startRelayLoop({ logger });
// BullMQ consumers start here once feature 11 adds them; add each to readiness.

const health = startHealthServer(config.WORKER_PORT, [
  { name: 'postgres', check: db.ping },
  { name: 'valkey', check: valkey.ping },
  {
    name: 'relay',
    check: async () => {
      if (!relay.isRunning()) throw new Error('relay loop stopped');
    },
  },
]);
health.on('listening', () => logger.info({ port: config.WORKER_PORT }, 'worker health listening'));

onShutdown(logger, [
  { name: 'relay', close: relay.stop },
  { name: 'postgres', close: db.close },
  { name: 'valkey', close: valkey.close },
  {
    name: 'health',
    close: () => new Promise((resolve, reject) => health.close((err) => (err ? reject(err) : resolve()))),
  },
]);
