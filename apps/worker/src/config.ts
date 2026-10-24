import { z } from 'zod';
import { loadConfig, logLevel, port, url } from '@payflow/shared';

const schema = z.object({
  DATABASE_URL: url,
  VALKEY_URL: url,
  WORKER_PORT: port(3100),
  LOG_LEVEL: logLevel,
});

export type Config = z.infer<typeof schema>;
export const config: Config = loadConfig(schema);
