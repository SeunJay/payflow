import { createAuthContext, createDb, createValkey } from '@payflow/core';
import { createLogger, onShutdown } from '@payflow/shared';
import { buildApp } from './app.ts';
import { config } from './config.ts';

const logger = createLogger({ name: 'api', level: config.LOG_LEVEL });
const db = createDb({ url: config.DATABASE_URL, logger });
const valkey = createValkey({ url: config.VALKEY_URL, logger });
const auth = await createAuthContext({
  jwtSecret: config.JWT_SECRET,
  accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  bcryptCost: config.BCRYPT_COST,
});

const app = buildApp({
  db: db.db,
  logger,
  config,
  auth,
  readiness: [
    { name: 'postgres', check: db.ping },
    { name: 'valkey', check: valkey.ping },
  ],
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
