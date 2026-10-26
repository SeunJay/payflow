import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import type { AuthContext, Db } from '@payflow/core';
import { createHttpApp, type ReadinessCheck } from '@payflow/http';
import type { Logger } from '@payflow/shared';
import type { Config } from './config-schema.ts';
import type { RouteDeps } from './deps.ts';
import { authRouter } from './routes/auth.ts';
import { meRouter } from './routes/me.ts';
import { walletRouter } from './routes/wallet.ts';

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
  const deps: RouteDeps = { db: options.db, auth: options.auth, cookieSecure: options.config.COOKIE_SECURE };
  return createHttpApp({
    logger: options.logger,
    readiness: options.readiness,
    mount: (app) => {
      app.use(cookieParser());
      app.use('/v1/auth', authRouter(deps));
      app.use('/v1', meRouter(deps), walletRouter(deps));
    },
  });
}
