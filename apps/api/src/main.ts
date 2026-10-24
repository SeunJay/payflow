import { createDb, createValkey } from '@payflow/core';
import { createHttpApp } from '@payflow/http';
import { createLogger, onShutdown } from '@payflow/shared';
import { config } from './config.ts';

const logger = createLogger({ name: 'api', level: config.LOG_LEVEL });
const db = createDb({ url: config.DATABASE_URL, logger });
const valkey = createValkey({ url: config.VALKEY_URL, logger });

const app = createHttpApp({
  logger,
  readiness: [
    { name: 'postgres', check: db.ping },
    { name: 'valkey', check: valkey.ping },
  ],
  mount: () => {
    // /v1 routes are mounted here as slices land.
  },
});

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, 'api listening');
});

onShutdown(logger, [
  {
    name: 'http',
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  },
  { name: 'postgres', close: db.close },
  { name: 'valkey', close: valkey.close },
]);
