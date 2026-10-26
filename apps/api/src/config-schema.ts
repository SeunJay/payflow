import { z } from 'zod';
import { logLevel, port, url } from '@payflow/shared';

const seconds = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

/** The API's env vars. Importing it has no side effect, so tests parse their own values. */
export const configSchema = z
  .object({
    DATABASE_URL: url,
    VALKEY_URL: url,
    API_PORT: port(3000),
    LOG_LEVEL: logLevel,
    JWT_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: seconds(60, 86_400, 900),
    REFRESH_TOKEN_TTL_SECONDS: seconds(3600, 2_592_000, 604_800),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    // Strict on purpose: `1`, `yes`, and `on` are typos here, not truthy.
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .refine((c) => c.REFRESH_TOKEN_TTL_SECONDS > c.ACCESS_TOKEN_TTL_SECONDS, {
    message: 'REFRESH_TOKEN_TTL_SECONDS must be greater than ACCESS_TOKEN_TTL_SECONDS',
    path: ['REFRESH_TOKEN_TTL_SECONDS'],
  });

export type Config = z.infer<typeof configSchema>;
