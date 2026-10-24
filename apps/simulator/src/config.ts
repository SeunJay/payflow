import { z } from 'zod';
import { loadConfig, logLevel, port, url } from '@payflow/shared';

const schema = z.object({
  SIMULATOR_DATABASE_URL: url,
  SIMULATOR_PORT: port(4000),
  LOG_LEVEL: logLevel,
});

export type Config = z.infer<typeof schema>;
export const config: Config = loadConfig(schema);
