import { createHttpApp } from '@payflow/http';
import { createLogger, onShutdown } from '@payflow/shared';
import { config } from './config.ts';
import { createSimulatorDb } from './db/client.ts';

const logger = createLogger({ name: 'simulator', level: config.LOG_LEVEL });
const db = createSimulatorDb({ url: config.SIMULATOR_DATABASE_URL, logger });

const app = createHttpApp({
  logger,
  readiness: [{ name: 'postgres', check: db.ping }],
  mount: () => {
    // Provider API routes are mounted here by feature 8.
  },
});

const server = app.listen(config.SIMULATOR_PORT, () => {
  logger.info({ port: config.SIMULATOR_PORT }, 'simulator listening');
});

onShutdown(logger, [
  {
    name: 'http',
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  },
  { name: 'postgres', close: db.close },
]);
