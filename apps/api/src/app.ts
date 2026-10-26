import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import type { AuthContext, Db } from '@payflow/core';
import { createHttpApp, type ReadinessCheck } from '@payflow/http';
import type { Logger } from '@payflow/shared';
import type { Config } from './config-schema.ts';
import type { FeatureDeps } from './deps.ts';
import { authFeature } from './features/auth/index.ts';
import { usersFeature } from './features/users/index.ts';
import { walletsFeature } from './features/wallets/index.ts';

/**
 * The API as an Express app with no listener, so `main.ts` serves it and
 * integration tests run the same app against their own database.
 */
export function buildApp(options: {
  db: Db;
  logger: Logger;
  config: Pick<Config, 'COOKIE_SECURE'>;
  auth: AuthContext;
  readiness: ReadinessCheck[];
}): Express {
  const deps: FeatureDeps = { db: options.db, auth: options.auth, cookieSecure: options.config.COOKIE_SECURE };
  return createHttpApp({
    logger: options.logger,
    readiness: options.readiness,
    mount: (app) => {
      app.use(cookieParser());
      app.use('/v1/auth', authFeature(deps));
      app.use('/v1', usersFeature(deps), walletsFeature(deps));
    },
  });
}
