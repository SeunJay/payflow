import { loadConfig } from '@payflow/shared';
import { configSchema, type Config } from './config-schema.ts';

export type { Config };
export const config: Config = loadConfig(configSchema);
