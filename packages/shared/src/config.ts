import { z } from 'zod';

/** Shared Zod pieces for app config schemas. */
export const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

export const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');

export const url = z.url();

/**
 * Parses env vars through an app's own schema. On bad config it prints every
 * problem and exits, so an app never starts half configured.
 */
export function loadConfig<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    console.error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}
